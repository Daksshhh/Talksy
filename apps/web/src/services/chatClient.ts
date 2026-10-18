import { create } from 'zustand';
import {
  LIMITS,
  type LobbyClientEvent,
  type LobbyServerEvent,
  type PeerInfo,
  type QuestCategoryId,
  type RealtimeTicketResponse,
  type ReportReason,
  type RoomClientEvent,
  type RoomServerEvent,
} from '@orbit/shared';
import { api, ApiError } from '@/lib/api';
import { env } from '@/lib/env';
import { newClientId } from '@/lib/utils';
import { getTurnstileToken } from '@/lib/turnstile';
import { addPending, initialChat, markFailed, markSending, reduceRoomEvent, resetSession, type ChatState } from '@/lib/chatReducer';

export const useChat = create<ChatState>(() => initialChat);
const set = (fn: (s: ChatState) => ChatState) => useChat.setState(fn(useChat.getState()), true);

const ACK_TIMEOUT_MS = 10_000;
const STALE_SOCKET_MS = LIMITS.HEARTBEAT_MS * 2 + 5_000;

/**
 * Realtime client (singleton). Manages two sockets:
 *  - lobby: queue/presence/match notifications (open while the user is in the app)
 *  - room:  the active random chat
 * Handles reconnect with exponential backoff, ticket refresh, device sleep, network
 * switches and resume-within-grace. UI state lives in the `useChat` store.
 */
class ChatClient {
  private lobby: WebSocket | null = null;
  private lobbyConnecting = false;
  private lobbyWanted = false;
  private lobbyAttempts = 0;
  private lobbyTimer: ReturnType<typeof setTimeout> | null = null;
  private lobbyLastMsg = 0;

  private room: WebSocket | null = null;
  private roomSessionId: string | null = null;
  private roomIntentionalClose = new WeakSet<WebSocket>();
  private roomLastMsg = 0;
  private resumeAttempts = 0;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending: Array<LobbyClientEvent> = [];
  private nextLocked = false;
  private lastEndedSession: string | null = null;
  private listenersInstalled = false;
  private anonymous = false;

  setAnonymous(v: boolean) {
    this.anonymous = v;
  }

  // ------------------------------------------------------------------ lifecycle
  ensureLobby(): void {
    this.installListeners();
    this.lobbyWanted = true;
    if (this.lobby || this.lobbyConnecting) return;
    void this.openLobby();
  }

  shutdown(): void {
    this.lobbyWanted = false;
    this.pending = [];
    this.closeRoom();
    if (this.lobby) {
      const l = this.lobby;
      this.lobby = null;
      l.close(1000, 'logout');
    }
    if (this.lobbyTimer) clearTimeout(this.lobbyTimer);
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.stopHeartbeat();
    this.ackTimers.forEach((t) => clearTimeout(t));
    this.ackTimers.clear();
    useChat.setState(initialChat, true);
  }

  private installListeners() {
    if (this.listenersInstalled || typeof window === 'undefined') return;
    this.listenersInstalled = true;
    window.addEventListener('online', () => {
      set((s) => ({ ...s, conn: 'reconnecting' }));
      this.wake();
    });
    window.addEventListener('offline', () => set((s) => ({ ...s, conn: 'offline' })));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.wake();
    });
    window.addEventListener('pageshow', () => this.wake());
  }

  /** After sleep/background/network change: verify sockets and reconnect fast. */
  private wake() {
    const now = Date.now();
    if (this.lobby && now - this.lobbyLastMsg > STALE_SOCKET_MS) this.lobby.close(4000, 'stale');
    if (this.room && now - this.roomLastMsg > STALE_SOCKET_MS) this.room.close(4000, 'stale');
    if (this.lobbyWanted && !this.lobby && !this.lobbyConnecting) {
      this.lobbyAttempts = 0;
      void this.openLobby();
    }
    const s = useChat.getState();
    if (s.phase === 'matched' && !this.room) this.requestResume(true);
  }

  private async openLobby(): Promise<void> {
    if (!navigator.onLine) {
      set((s) => ({ ...s, conn: 'offline' }));
      return;
    }
    this.lobbyConnecting = true;
    let ticket: RealtimeTicketResponse;
    try {
      const headers: Record<string, string> = {};
      if (env.turnstileEnabled && this.anonymous) {
        const t = await getTurnstileToken().catch(() => null);
        if (t) headers['X-Turnstile-Token'] = t;
      }
      ticket = await api<RealtimeTicketResponse>('/api/realtime-ticket', { method: 'POST', body: {}, headers });
    } catch (err) {
      this.lobbyConnecting = false;
      if (err instanceof ApiError && (err.code === 'restricted' || err.code === 'not_onboarded' || err.status === 401)) {
        this.lobbyWanted = false;
        set((s) => ({ ...s, phase: s.phase === 'searching' ? 'idle' : s.phase, error: err.message }));
        return;
      }
      this.scheduleLobbyReconnect();
      return;
    }
    const ws = new WebSocket(`${env.wsBase}/ws/lobby?ticket=${encodeURIComponent(ticket.ticket)}`);
    this.lobby = ws;
    ws.onopen = () => {
      this.lobbyConnecting = false;
      this.lobbyAttempts = 0;
      this.lobbyLastMsg = Date.now();
      set((s) => ({ ...s, conn: 'online' }));
      this.startHeartbeat();
      const queued = this.pending.splice(0);
      queued.forEach((e) => this.sendLobby(e));
    };
    ws.onmessage = (m) => {
      this.lobbyLastMsg = Date.now();
      try {
        this.onLobby(JSON.parse(m.data as string) as LobbyServerEvent);
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      this.lobbyConnecting = false;
      if (this.lobby === ws) this.lobby = null;
      if (this.lobbyWanted) {
        set((s) => ({ ...s, conn: navigator.onLine ? 'reconnecting' : 'offline' }));
        this.scheduleLobbyReconnect();
      }
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleLobbyReconnect() {
    if (!this.lobbyWanted || this.lobbyTimer) return;
    const delay = Math.min(15_000, 500 * 2 ** this.lobbyAttempts) + Math.random() * 400;
    this.lobbyAttempts++;
    this.lobbyTimer = setTimeout(() => {
      this.lobbyTimer = null;
      if (this.lobbyWanted && !this.lobby) void this.openLobby();
    }, delay);
  }

  private startHeartbeat() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      const now = Date.now();
      if (this.lobby?.readyState === WebSocket.OPEN) {
        if (now - this.lobbyLastMsg > STALE_SOCKET_MS) this.lobby.close(4000, 'stale');
        else this.lobby.send('{"type":"ping"}');
      }
      if (this.room?.readyState === WebSocket.OPEN) {
        if (now - this.roomLastMsg > STALE_SOCKET_MS) this.room.close(4000, 'stale');
        else this.room.send('{"type":"ping"}');
      }
    }, LIMITS.HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private sendLobby(ev: LobbyClientEvent): void {
    if (this.lobby?.readyState === WebSocket.OPEN) this.lobby.send(JSON.stringify(ev));
    else {
      // Queue (deduplicated) until the lobby is open.
      if (!this.pending.some((p) => p.type === ev.type)) this.pending.push(ev);
      this.ensureLobby();
    }
  }

  private sendRoom(ev: RoomClientEvent): boolean {
    if (this.room?.readyState === WebSocket.OPEN) {
      this.room.send(JSON.stringify(ev));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ lobby events
  private onLobby(ev: LobbyServerEvent): void {
    const s = useChat.getState();
    switch (ev.type) {
      case 'hello':
        set((st) => ({ ...st, counts: { online: ev.online, waiting: ev.waiting, inChat: st.counts?.inChat ?? 0 } }));
        if (ev.state === 'MATCHED' && ev.activeSessionId) {
          if (!(this.room && this.roomSessionId === ev.activeSessionId)) this.sendLobby({ type: 'session:resume' });
        } else if (ev.state === 'IDLE') {
          // Server lost our queue entry while we were disconnected: re-queue.
          if (s.phase === 'searching' && !this.pending.some((p) => p.type === 'queue:join' || p.type === 'queue:next')) this.sendLobby({ type: 'queue:join' });
          if (s.phase === 'matched' && !this.room) this.endLocally('expired');
        }
        break;
      case 'queue:waiting':
        set((st) => ({ ...st, phase: st.phase === 'matched' ? st.phase : 'searching', queue: { since: ev.since, waiting: ev.waiting } }));
        break;
      case 'queue:matched':
        this.connectRoom(ev.sessionId, ev.roomToken, ev.peer, ev.resumed);
        break;
      case 'queue:left':
        set((st) => (st.phase === 'searching' ? { ...st, phase: 'idle', queue: null } : st));
        break;
      case 'queue:error':
        if (ev.code === 'already_in_session') {
          if (ev.sessionId && ev.sessionId === this.lastEndedSession) setTimeout(() => this.sendLobby({ type: 'queue:join' }), 700);
          else this.sendLobby({ type: 'session:resume' });
          break;
        }
        set((st) => ({ ...st, phase: st.phase === 'searching' ? 'idle' : st.phase, notice: ev.message }));
        break;
      case 'session:none':
        if (s.phase === 'matched' && !this.room) this.endLocally('expired');
        break;
      case 'presence:count':
        set((st) => ({ ...st, counts: { online: ev.online, waiting: ev.waiting, inChat: ev.inChat } }));
        break;
      case 'error':
        if (ev.code === 'restricted') {
          this.lobbyWanted = false;
          this.closeRoom();
          set((st) => ({ ...resetSession(st, 'idle'), error: ev.message }));
        }
        break;
      default:
        break;
    }
  }

  private endLocally(reason: 'expired' | 'timeout') {
    if (this.roomSessionId) this.lastEndedSession = this.roomSessionId;
    this.closeRoom();
    set((st) => reduceRoomEvent(st, { type: 'chat:ended', reason, by: 'system' }));
  }

  // ------------------------------------------------------------------ room
  private connectRoom(sessionId: string, token: string, peer: PeerInfo, resumed: boolean): void {
    if (this.room && this.roomSessionId !== sessionId) this.closeRoom();
    if (this.room && this.roomSessionId === sessionId) this.closeRoom();
    const isNew = this.roomSessionId !== sessionId || !resumed;
    this.roomSessionId = sessionId;
    if (isNew && useChat.getState().sessionId !== sessionId) {
      set((st) => ({ ...resetSession(st, 'matched'), sessionId, peer, conn: st.conn }));
    } else {
      set((st) => ({ ...st, phase: 'matched', sessionId, peer, roomReady: false }));
    }
    const ws = new WebSocket(`${env.wsBase}/ws/room/${sessionId}?token=${encodeURIComponent(token)}`);
    this.room = ws;
    ws.onopen = () => {
      this.roomLastMsg = Date.now();
      this.startHeartbeat();
    };
    ws.onmessage = (m) => {
      this.roomLastMsg = Date.now();
      let ev: RoomServerEvent;
      try {
        ev = JSON.parse(m.data as string);
      } catch {
        return;
      }
      if (ev.type === 'pong') return;
      if (ev.type === 'chat:ready') {
        this.resumeAttempts = 0;
        // Resend messages that were still in flight when the connection dropped (same clientMsgId => no duplicates).
        const inflight = new Set(useChat.getState().messages.filter((x) => x.status === 'sending' && x.clientMsgId).map((x) => x.clientMsgId!));
        set((st) => reduceRoomEvent(st, ev));
        for (const msg of useChat.getState().messages) if (msg.status === 'failed' && msg.clientMsgId && inflight.has(msg.clientMsgId)) this.retry(msg.clientMsgId);
        return;
      }
      if (ev.type === 'chat:ack' || (ev.type === 'chat:rejected' && ev.clientMsgId)) {
        const t = this.ackTimers.get(ev.clientMsgId!);
        if (t) clearTimeout(t);
        this.ackTimers.delete(ev.clientMsgId!);
      }
      if (ev.type === 'chat:ended') {
        this.lastEndedSession = sessionId;
        this.roomIntentionalClose.add(ws);
      }
      set((st) => reduceRoomEvent(st, ev));
    };
    ws.onclose = () => {
      if (this.room !== ws) return;
      this.room = null;
      const st = useChat.getState();
      if (this.roomIntentionalClose.has(ws) || st.phase !== 'matched' || st.sessionId !== sessionId) return;
      // Unexpected drop: never show "connected" while we're not.
      set((x) => ({ ...x, roomReady: false, conn: navigator.onLine ? 'reconnecting' : 'offline' }));
      this.requestResume(false);
    };
  }

  /** Ask the coordinator for a fresh room token (valid only within the room's grace period). */
  private requestResume(immediate: boolean) {
    if (this.resumeTimer) return;
    const grace = LIMITS.RECONNECT_GRACE_MS;
    if (this.resumeAttempts > 8) {
      this.endLocally('timeout');
      return;
    }
    const delay = immediate ? 0 : Math.min(grace / 4, 400 * 2 ** this.resumeAttempts);
    this.resumeAttempts++;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (useChat.getState().phase !== 'matched' || this.room) return;
      this.sendLobby({ type: 'session:resume' });
      // If the room never comes back, try again (bounded by attempts).
      setTimeout(() => {
        if (useChat.getState().phase === 'matched' && !this.room) this.requestResume(false);
      }, 4000);
    }, delay);
  }

  private closeRoom() {
    if (this.room) {
      const r = this.room;
      this.roomIntentionalClose.add(r);
      this.room = null;
      try {
        r.close(1000, 'client');
      } catch {
        /* ignore */
      }
    }
    this.roomSessionId = null;
  }

  // ------------------------------------------------------------------ user actions
  start(): void {
    const s = useChat.getState();
    if (s.phase === 'searching' || (s.phase === 'matched' && s.roomReady)) return;
    this.closeRoom();
    set((st) => ({ ...resetSession(st, 'searching'), queue: { since: Date.now(), waiting: st.counts?.waiting ?? 0 } }));
    this.sendLobby({ type: 'queue:join' });
  }

  cancel(): void {
    this.pending = this.pending.filter((p) => p.type !== 'queue:join');
    this.sendLobby({ type: 'queue:leave' });
    set((st) => ({ ...st, phase: 'idle', queue: null }));
  }

  /** Next Stranger — guarded against double taps. */
  next(): void {
    if (this.nextLocked) return;
    this.nextLocked = true;
    setTimeout(() => (this.nextLocked = false), 1300);
    if (this.roomSessionId) this.lastEndedSession = this.roomSessionId;
    this.closeRoom();
    set((st) => ({ ...resetSession(st, 'searching'), queue: { since: Date.now(), waiting: st.counts?.waiting ?? 0 } }));
    this.pending = this.pending.filter((p) => p.type !== 'queue:join');
    this.sendLobby({ type: 'queue:next' });
  }

  end(): void {
    const sid = this.roomSessionId;
    if (sid) this.lastEndedSession = sid;
    // Room fallback in case the lobby is momentarily down.
    this.sendRoom({ type: 'chat:leave', reason: 'left' });
    this.sendLobby({ type: 'session:end' });
    this.closeRoom();
    set((st) => reduceRoomEvent(st, { type: 'chat:ended', reason: 'left', by: 'me' }));
  }

  backToIdle(): void {
    set((st) => resetSession(st, 'idle'));
  }

  sendMessage(text: string): boolean {
    const st = useChat.getState();
    if (st.phase !== 'matched' || !st.roomReady) return false;
    const clientMsgId = newClientId();
    set((x) => addPending(x, clientMsgId, text, Date.now()));
    this.dispatch(clientMsgId, text);
    return true;
  }

  retry(clientMsgId: string): void {
    const m = useChat.getState().messages.find((x) => x.clientMsgId === clientMsgId);
    if (!m) return;
    set((x) => markSending(x, clientMsgId));
    this.dispatch(clientMsgId, m.text);
  }

  private dispatch(clientMsgId: string, text: string) {
    const sent = this.sendRoom({ type: 'chat:send', clientMsgId, text });
    const prev = this.ackTimers.get(clientMsgId);
    if (prev) clearTimeout(prev);
    if (!sent) {
      set((x) => markFailed(x, clientMsgId, 'Not connected'));
      return;
    }
    this.ackTimers.set(
      clientMsgId,
      setTimeout(() => {
        this.ackTimers.delete(clientMsgId);
        set((x) => markFailed(x, clientMsgId, 'Not delivered'));
      }, ACK_TIMEOUT_MS),
    );
  }

  typing(isTyping: boolean) {
    this.sendRoom({ type: 'chat:typing', isTyping });
  }
  requestSave() {
    this.sendRoom({ type: 'chat:save_request' });
  }
  respondSave(accept: boolean) {
    this.sendRoom({ type: 'chat:save_respond', accept });
  }
  report(reason: ReportReason, details: string, alsoBlock: boolean): boolean {
    return this.sendRoom({ type: 'chat:report', reason, details, alsoBlock });
  }
  questPropose(category: QuestCategoryId) {
    this.sendRoom({ type: 'quest:propose', category });
  }
  questRespond(accept: boolean) {
    this.sendRoom({ type: 'quest:respond', accept });
  }
  questAnswer(questionId: string, answer: string, guess?: string) {
    this.sendRoom({ type: 'quest:answer', questionId, answer, guess });
  }
  questNext() {
    this.sendRoom({ type: 'quest:next' });
  }
  questSkip() {
    this.sendRoom({ type: 'quest:skip' });
  }
  questEnd() {
    this.sendRoom({ type: 'quest:end' });
  }
  clearNotice() {
    set((s) => ({ ...s, notice: null }));
  }
  markFriendRequestSent(status: 'pending' | 'accepted') {
    set((s) => ({ ...s, friendRequest: status === 'accepted' ? 'friends' : 'sent' }));
  }
}

export const chatClient = new ChatClient();
