import type { ChatMessageView, EndReason, PeerInfo, QuestView, RoomServerEvent, SaveState } from '@orbit/shared';

/** Pure state transitions for the random-chat screen (unit-tested). */
export type Phase = 'idle' | 'connecting' | 'searching' | 'matched' | 'ended';
export type Conn = 'online' | 'reconnecting' | 'offline';

export interface UiMessage extends ChatMessageView {
  status: 'sending' | 'sent' | 'failed';
  error?: string;
}

export interface ChatState {
  phase: Phase;
  conn: Conn;
  sessionId: string | null;
  peer: PeerInfo | null;
  me: PeerInfo | null;
  /** True only after the server confirmed the room and the peer's socket is live. */
  peerConnected: boolean;
  roomReady: boolean;
  peerTyping: boolean;
  messages: UiMessage[];
  quest: QuestView | null;
  questNotice: string | null;
  save: SaveState;
  endReason: EndReason | null;
  endedBy: 'me' | 'peer' | 'system' | null;
  queue: { since: number; waiting: number } | null;
  counts: { online: number; waiting: number; inChat: number } | null;
  friendRequest: 'none' | 'sent' | 'received' | 'friends';
  reported: boolean;
  notice: string | null;
  error: string | null;
  startedAt: number | null;
}

export const initialChat: ChatState = {
  phase: 'idle',
  conn: 'online',
  sessionId: null,
  peer: null,
  me: null,
  peerConnected: false,
  roomReady: false,
  peerTyping: false,
  messages: [],
  quest: null,
  questNotice: null,
  save: 'none',
  endReason: null,
  endedBy: null,
  queue: null,
  counts: null,
  friendRequest: 'none',
  reported: false,
  notice: null,
  error: null,
  startedAt: null,
};

/** Clear everything that belongs to a single conversation (keeps counts/conn). */
export function resetSession(s: ChatState, phase: Phase): ChatState {
  return { ...initialChat, counts: s.counts, conn: s.conn, phase };
}

export function addPending(s: ChatState, clientMsgId: string, text: string, ts: number): ChatState {
  return { ...s, messages: [...s.messages, { id: `local-${clientMsgId}`, clientMsgId, from: 'me', text, ts, status: 'sending' }] };
}

export function markSending(s: ChatState, clientMsgId: string): ChatState {
  return { ...s, messages: s.messages.map((m) => (m.clientMsgId === clientMsgId && m.from === 'me' ? { ...m, status: 'sending', error: undefined } : m)) };
}

export function markFailed(s: ChatState, clientMsgId: string, error: string): ChatState {
  return {
    ...s,
    messages: s.messages.map((m) => (m.clientMsgId === clientMsgId && m.status === 'sending' ? { ...m, status: 'failed', error } : m)),
  };
}

function mergeServerHistory(local: UiMessage[], server: ChatMessageView[]): UiMessage[] {
  const out: UiMessage[] = server.map((m) => ({ ...m, status: 'sent' as const }));
  const known = new Set(server.map((m) => m.clientMsgId).filter(Boolean));
  // Keep local messages the server never acknowledged (they can be retried).
  for (const m of local) if (m.status !== 'sent' && m.clientMsgId && !known.has(m.clientMsgId)) out.push({ ...m, status: 'failed', error: m.error ?? 'Not delivered' });
  return out.sort((a, b) => a.ts - b.ts);
}

export function reduceRoomEvent(s: ChatState, ev: RoomServerEvent): ChatState {
  switch (ev.type) {
    case 'chat:ready':
      return {
        ...s,
        phase: 'matched',
        conn: 'online',
        sessionId: ev.sessionId,
        me: ev.you,
        peer: ev.peer,
        peerConnected: ev.peerConnected,
        roomReady: true,
        messages: mergeServerHistory(s.messages, ev.messages),
        quest: ev.quest,
        save: ev.save,
        startedAt: ev.startedAt,
        error: null,
      };
    case 'chat:message': {
      if (s.messages.some((m) => m.id === ev.message.id)) return s;
      return { ...s, peerTyping: ev.message.from === 'peer' ? false : s.peerTyping, messages: [...s.messages, { ...ev.message, status: 'sent' }] };
    }
    case 'chat:ack': {
      const dup = s.messages.some((m) => m.id === ev.id);
      return {
        ...s,
        messages: dup
          ? s.messages.filter((m) => !(m.clientMsgId === ev.clientMsgId && m.id !== ev.id))
          : s.messages.map((m) => (m.clientMsgId === ev.clientMsgId && m.from === 'me' ? { ...m, id: ev.id, ts: ev.ts, status: 'sent', error: undefined } : m)),
      };
    }
    case 'chat:rejected':
      if (ev.clientMsgId) return markFailed(s, ev.clientMsgId, ev.message);
      return { ...s, notice: ev.message };
    case 'chat:typing':
      return { ...s, peerTyping: ev.isTyping };
    case 'chat:peer_status':
      return { ...s, peerConnected: ev.status === 'connected', peerTyping: false };
    case 'chat:ended':
      return {
        ...s,
        phase: 'ended',
        endReason: ev.reason,
        endedBy: ev.by,
        peerConnected: false,
        roomReady: false,
        peerTyping: false,
        quest: null,
        messages: s.messages.map((m) => (m.status === 'sending' ? { ...m, status: 'failed', error: 'Chat ended' } : m)),
      };
    case 'chat:save_state':
      return { ...s, save: ev.state };
    case 'chat:friend_request':
      if (ev.status === 'accepted') return { ...s, friendRequest: 'friends' };
      return { ...s, friendRequest: ev.direction === 'incoming' ? (s.friendRequest === 'sent' ? 'friends' : 'received') : 'sent' };
    case 'chat:report_ack':
      return { ...s, reported: true };
    case 'quest:state':
      return { ...s, quest: ev.quest, questNotice: ev.notice ?? null };
    case 'error':
      return { ...s, notice: ev.message };
    default:
      return s;
  }
}
