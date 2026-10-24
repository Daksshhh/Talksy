import {
  LIMITS,
  RATE_LIMITS,
  extractLinks,
  floodKey,
  sanitizeText,
  type ChatMessageView,
  type EndReason,
  type PeerInfo,
  type QuestCategoryId,
  type QuestQuestionView,
  type QuestView,
  type ReportReason,
  type RoomClientEvent,
  type RoomErrorCode,
  type RoomServerEvent,
  type SaveState,
} from '@orbit/shared';
import { SlidingWindowLimiter } from '../lib/rateLimiter';

/**
 * Pure state machine for one random-chat room (exactly two participants).
 * The ChatRoom Durable Object feeds it socket events and executes returned effects.
 *
 * Session states: CREATING -> ACTIVE <-> RECONNECTING -> ENDED
 */
export type SessionState = 'CREATING' | 'ACTIVE' | 'RECONNECTING' | 'ENDED';

export interface RoomParticipant {
  userId: string;
  profile: PeerInfo;
  connected: boolean;
  everConnected: boolean;
  disconnectedAt: number | null;
}

export interface RoomMessage {
  seq: number;
  id: string;
  senderId: string | null;
  clientMsgId?: string;
  text: string;
  ts: number;
  hasLink: boolean;
}

interface QuestInternal {
  status: 'proposed' | 'active' | 'revealed';
  category: QuestCategoryId;
  proposedBy: string;
  round: number;
  questionId: string | null;
  answers: Record<string, { answer: string; guess?: string }>;
  used: string[];
  startedAt: number;
}

export interface EvidenceLine {
  from: 'reporter' | 'reported' | 'system';
  text: string;
  ts: number;
}

export type RoomEffect =
  | { kind: 'send'; to: string; event: RoomServerEvent }
  | { kind: 'ended'; reason: EndReason; by: string | null }
  | { kind: 'close'; userId: string }
  | {
      kind: 'report';
      reporterId: string;
      reportedId: string;
      reason: ReportReason;
      details: string;
      evidence: EvidenceLine[];
      alsoBlock: boolean;
    }
  | { kind: 'save_transcript'; messages: RoomMessage[]; consentedBy: string[] }
  | { kind: 'archive_message'; message: RoomMessage }
  | { kind: 'safety_event'; userId: string; event: string; detail: Record<string, unknown> }
  | { kind: 'quest_summary'; category: QuestCategoryId; rounds: number; startedAt: number }
  | { kind: 'activated' };

export interface RoomMeta {
  roomId: string;
  status: SessionState;
  createdAt: number;
  activatedAt: number | null;
  endedAt: number | null;
  endReason: EndReason | null;
  participants: RoomParticipant[];
  quest: QuestInternal | null;
  saveRequestedBy: string | null;
  saveConsent: string[];
  saveDeclined: boolean;
  seq: number;
  usedTokenNonces: string[];
  strikes: Record<string, number>;
  questRoundsCompleted: number;
}

export interface RoomEngineOptions {
  now: () => number;
  newId: () => string;
  graceMs: number;
  pickQuestion: (category: QuestCategoryId, used: string[]) => QuestQuestionView;
  getQuestion: (id: string) => QuestQuestionView | undefined;
}

export class RoomEngine {
  meta: RoomMeta;
  messages: RoomMessage[];
  private msgLimiter: SlidingWindowLimiter;
  private typingLimiter: SlidingWindowLimiter;
  private questLimiter: SlidingWindowLimiter;
  private saveLimiter: SlidingWindowLimiter;
  private recentKeys = new Map<string, Array<{ key: string; ts: number }>>();
  private typingState = new Map<string, boolean>();

  constructor(
    meta: RoomMeta,
    messages: RoomMessage[],
    private readonly opts: RoomEngineOptions,
  ) {
    this.meta = meta;
    this.messages = messages;
    this.msgLimiter = new SlidingWindowLimiter(RATE_LIMITS.chatMessage.limit, RATE_LIMITS.chatMessage.windowMs, opts.now);
    this.typingLimiter = new SlidingWindowLimiter(RATE_LIMITS.typing.limit, RATE_LIMITS.typing.windowMs, opts.now);
    this.questLimiter = new SlidingWindowLimiter(RATE_LIMITS.quest.limit, RATE_LIMITS.quest.windowMs, opts.now);
    this.saveLimiter = new SlidingWindowLimiter(RATE_LIMITS.saveRequest.limit, RATE_LIMITS.saveRequest.windowMs, opts.now);
  }

  static create(
    roomId: string,
    a: { userId: string; profile: PeerInfo },
    b: { userId: string; profile: PeerInfo },
    opts: RoomEngineOptions,
  ): RoomEngine {
    if (a.userId === b.userId) throw new Error('cannot create a room with the same user twice');
    const meta: RoomMeta = {
      roomId,
      status: 'CREATING',
      createdAt: opts.now(),
      activatedAt: null,
      endedAt: null,
      endReason: null,
      participants: [a, b].map((p) => ({
        userId: p.userId,
        profile: p.profile,
        connected: false,
        everConnected: false,
        disconnectedAt: null,
      })),
      quest: null,
      saveRequestedBy: null,
      saveConsent: [],
      saveDeclined: false,
      seq: 0,
      usedTokenNonces: [],
      strikes: {},
      questRoundsCompleted: 0,
    };
    return new RoomEngine(meta, [], opts);
  }

  // ------------------------------------------------------------------ helpers
  isParticipant(userId: string): boolean {
    return this.meta.participants.some((p) => p.userId === userId);
  }
  private me(userId: string): RoomParticipant {
    const p = this.meta.participants.find((x) => x.userId === userId);
    if (!p) throw new Error('not a participant');
    return p;
  }
  peerOf(userId: string): RoomParticipant {
    const p = this.meta.participants.find((x) => x.userId !== userId);
    if (!p) throw new Error('no peer');
    return p;
  }
  get ended(): boolean {
    return this.meta.status === 'ENDED';
  }

  /** Single-use room tokens: returns false if the nonce was already used. */
  consumeNonce(nonce: string): boolean {
    if (this.meta.usedTokenNonces.includes(nonce)) return false;
    this.meta.usedTokenNonces.push(nonce);
    if (this.meta.usedTokenNonces.length > 50) this.meta.usedTokenNonces.shift();
    return true;
  }

  private view(m: RoomMessage, forUser: string): ChatMessageView {
    return {
      id: m.id,
      clientMsgId: m.senderId === forUser ? m.clientMsgId : undefined,
      from: m.senderId === null ? 'system' : m.senderId === forUser ? 'me' : 'peer',
      text: m.text,
      ts: m.ts,
      hasLink: m.hasLink || undefined,
    };
  }

  saveStateFor(userId: string): SaveState {
    if (this.meta.saveConsent.length >= 2) return 'saved';
    if (this.meta.saveDeclined) return 'declined';
    if (!this.meta.saveRequestedBy) return 'none';
    return this.meta.saveRequestedBy === userId ? 'requested_by_me' : 'requested_by_peer';
  }

  questViewFor(userId: string): QuestView | null {
    const q = this.meta.quest;
    if (!q) return null;
    const peer = this.peerOf(userId).userId;
    const question = q.questionId ? this.opts.getQuestion(q.questionId) : undefined;
    const v: QuestView = {
      status: q.status,
      category: q.category,
      proposedBy: q.proposedBy === userId ? 'me' : 'peer',
      round: q.round,
      question,
      myAnswered: !!q.answers[userId],
      peerAnswered: !!q.answers[peer],
    };
    if (q.status === 'revealed' && question) {
      const mine = q.answers[userId];
      const theirs = q.answers[peer];
      v.reveal = { mine, peer: theirs };
      if (question.kind === 'choice') v.reveal.sameChoice = mine.answer === theirs.answer;
      if (question.kind === 'guess') {
        v.reveal.myGuessCorrect = mine.guess === theirs.answer;
        v.reveal.peerGuessCorrect = theirs.guess === mine.answer;
      }
    }
    return v;
  }

  private both(fn: (userId: string) => RoomServerEvent): RoomEffect[] {
    return this.meta.participants.map((p) => ({ kind: 'send' as const, to: p.userId, event: fn(p.userId) }));
  }

  private questBroadcast(notice?: (userId: string) => string | undefined): RoomEffect[] {
    return this.both((u) => ({ type: 'quest:state', quest: this.questViewFor(u), notice: notice?.(u) }));
  }

  private reject(userId: string, code: RoomErrorCode, message: string, clientMsgId?: string, retryAfterMs?: number): RoomEffect[] {
    return [{ kind: 'send', to: userId, event: { type: 'chat:rejected', code, message, clientMsgId, retryAfterMs } }];
  }

  private strike(userId: string, why: string): RoomEffect[] {
    const n = (this.meta.strikes[userId] ?? 0) + 1;
    this.meta.strikes[userId] = n;
    if (n >= LIMITS.ABUSE_STRIKES_BEFORE_KICK) {
      return [
        { kind: 'safety_event', userId, event: 'room_abuse_kick', detail: { why, strikes: n, roomId: this.meta.roomId } },
        ...this.end('moderation', null),
      ];
    }
    return [];
  }

  // ------------------------------------------------------------------ lifecycle
  connect(userId: string): RoomEffect[] {
    if (this.ended) return [{ kind: 'send', to: userId, event: { type: 'chat:ended', reason: this.meta.endReason ?? 'expired', by: 'system' } }, { kind: 'close', userId }];
    const me = this.me(userId);
    const peer = this.peerOf(userId);
    const wasConnected = me.connected;
    me.connected = true;
    me.everConnected = true;
    me.disconnectedAt = null;
    const out: RoomEffect[] = [];
    const bothConnected = this.meta.participants.every((p) => p.connected);
    if (this.meta.status === 'CREATING' && bothConnected) {
      this.meta.status = 'ACTIVE';
      this.meta.activatedAt = this.opts.now();
      out.push({ kind: 'activated' });
    } else if (this.meta.status === 'RECONNECTING' && bothConnected) {
      this.meta.status = 'ACTIVE';
    }
    out.push({
      kind: 'send',
      to: userId,
      event: {
        type: 'chat:ready',
        sessionId: this.meta.roomId,
        you: me.profile,
        peer: peer.profile,
        peerConnected: peer.connected,
        startedAt: this.meta.createdAt,
        messages: this.messages.map((m) => this.view(m, userId)),
        quest: this.questViewFor(userId),
        save: this.saveStateFor(userId),
      },
    });
    if (!wasConnected) out.push({ kind: 'send', to: peer.userId, event: { type: 'chat:peer_status', status: 'connected' } });
    return out;
  }

  disconnect(userId: string): RoomEffect[] {
    if (this.ended || !this.isParticipant(userId)) return [];
    const me = this.me(userId);
    if (!me.connected) return [];
    me.connected = false;
    me.disconnectedAt = this.opts.now();
    this.typingState.set(userId, false);
    if (this.meta.status === 'ACTIVE') this.meta.status = 'RECONNECTING';
    const peer = this.peerOf(userId);
    return [
      { kind: 'send', to: peer.userId, event: { type: 'chat:typing', isTyping: false } },
      { kind: 'send', to: peer.userId, event: { type: 'chat:peer_status', status: 'reconnecting' } },
    ];
  }

  /** When should the DO alarm fire next? */
  nextDeadline(): number | null {
    if (this.ended) return null;
    const deadlines: number[] = [];
    for (const p of this.meta.participants) {
      if (!p.connected) {
        const since = p.disconnectedAt ?? this.meta.createdAt;
        deadlines.push(since + this.opts.graceMs);
      }
    }
    return deadlines.length ? Math.min(...deadlines) : null;
  }

  /** Enforce reconnect grace periods. */
  tick(): RoomEffect[] {
    if (this.ended) return [];
    const now = this.opts.now();
    for (const p of this.meta.participants) {
      if (p.connected) continue;
      const since = p.disconnectedAt ?? this.meta.createdAt;
      if (now - since >= this.opts.graceMs) {
        return this.end(p.everConnected ? 'timeout' : 'expired', p.everConnected ? p.userId : null);
      }
    }
    return [];
  }

  /** End the session (idempotent). `by` = user who caused it, or null for system. */
  end(reason: EndReason, by: string | null): RoomEffect[] {
    if (this.ended) return [];
    const out: RoomEffect[] = [];
    if (this.meta.quest) {
      out.push({ kind: 'quest_summary', category: this.meta.quest.category, rounds: this.meta.questRoundsCompleted, startedAt: this.meta.quest.startedAt });
      this.meta.quest = null;
    }
    this.meta.status = 'ENDED';
    this.meta.endReason = reason;
    this.meta.endedAt = this.opts.now();
    if (this.meta.saveConsent.length >= 2 && this.messages.some((m) => m.senderId)) {
      out.push({ kind: 'save_transcript', messages: [...this.messages], consentedBy: [...this.meta.saveConsent] });
    }
    for (const p of this.meta.participants) {
      out.push({
        kind: 'send',
        to: p.userId,
        event: { type: 'chat:ended', reason, by: by === null ? 'system' : by === p.userId ? 'me' : 'peer' },
      });
      out.push({ kind: 'close', userId: p.userId });
    }
    out.push({ kind: 'ended', reason, by });
    // Privacy: drop the in-memory buffer once the room ends.
    this.messages = [];
    return out;
  }

  // ------------------------------------------------------------------ events
  handle(userId: string, ev: RoomClientEvent): RoomEffect[] {
    if (!this.isParticipant(userId)) return [];
    if (ev.type === 'ping') return [{ kind: 'send', to: userId, event: { type: 'pong', ts: this.opts.now() } }];
    if (this.ended) return this.reject(userId, 'not_active', 'This chat has ended.');
    switch (ev.type) {
      case 'chat:send':
        return this.onSend(userId, ev.clientMsgId, ev.text);
      case 'chat:typing':
        return this.onTyping(userId, ev.isTyping);
      case 'chat:leave':
        return this.end(ev.reason, userId);
      case 'chat:save_request':
        return this.onSaveRequest(userId);
      case 'chat:save_respond':
        return this.onSaveRespond(userId, ev.accept);
      case 'chat:report':
        return this.onReport(userId, ev.reason, ev.details, ev.alsoBlock);
      case 'quest:propose':
        return this.onQuestPropose(userId, ev.category);
      case 'quest:respond':
        return this.onQuestRespond(userId, ev.accept);
      case 'quest:answer':
        return this.onQuestAnswer(userId, ev.questionId, ev.answer, ev.guess);
      case 'quest:next':
      case 'quest:skip':
        return this.onQuestAdvance(userId, ev.type === 'quest:skip');
      case 'quest:end':
        return this.onQuestEnd(userId);
      default:
        return [];
    }
  }

  private onSend(userId: string, clientMsgId: string, rawText: string): RoomEffect[] {
    if (this.meta.status === 'CREATING') return this.reject(userId, 'not_active', 'Waiting for the stranger to connect…', clientMsgId);
    // Idempotent retries: same clientMsgId => re-ack, never duplicate.
    const existing = this.messages.find((m) => m.senderId === userId && m.clientMsgId === clientMsgId);
    if (existing) return [{ kind: 'send', to: userId, event: { type: 'chat:ack', clientMsgId, id: existing.id, ts: existing.ts } }];

    const t = sanitizeText(rawText, LIMITS.MESSAGE_MAX_CHARS);
    if (!t.ok) {
      if (t.error === 'too_long') return this.reject(userId, 'too_long', `Messages can be up to ${LIMITS.MESSAGE_MAX_CHARS} characters.`, clientMsgId);
      return this.reject(userId, 'empty', 'Message is empty.', clientMsgId);
    }
    const wait = this.msgLimiter.take(userId);
    if (wait) return [...this.reject(userId, 'rate_limited', 'Slow down a little.', clientMsgId, wait), ...this.strike(userId, 'rate')];

    const links = extractLinks(t.value);
    if (links.length > LIMITS.MAX_LINKS_PER_MESSAGE)
      return [...this.reject(userId, 'too_many_links', 'Too many links in one message.', clientMsgId), ...this.strike(userId, 'links')];

    const now = this.opts.now();
    const key = floodKey(t.value);
    const recent = (this.recentKeys.get(userId) ?? []).filter((r) => now - r.ts < LIMITS.FLOOD_DUPLICATE_WINDOW_MS);
    if (recent.filter((r) => r.key === key).length >= LIMITS.FLOOD_DUPLICATE_MAX) {
      this.recentKeys.set(userId, recent);
      return [...this.reject(userId, 'flood', 'Please don\'t repeat the same message.', clientMsgId), ...this.strike(userId, 'flood')];
    }
    recent.push({ key, ts: now });
    this.recentKeys.set(userId, recent.slice(-20));

    const msg: RoomMessage = {
      seq: ++this.meta.seq,
      id: this.opts.newId(),
      senderId: userId,
      clientMsgId,
      text: t.value,
      ts: now,
      hasLink: links.length > 0,
    };
    this.messages.push(msg);
    if (this.messages.length > LIMITS.ROOM_BUFFER_MAX) this.messages.splice(0, this.messages.length - LIMITS.ROOM_BUFFER_MAX);
    const peer = this.peerOf(userId).userId;
    this.typingState.set(userId, false);
    return [
      { kind: 'archive_message', message: msg },
      { kind: 'send', to: userId, event: { type: 'chat:ack', clientMsgId, id: msg.id, ts: msg.ts } },
      { kind: 'send', to: peer, event: { type: 'chat:message', message: this.view(msg, peer) } },
    ];
  }

  private onTyping(userId: string, isTyping: boolean): RoomEffect[] {
    if (this.meta.status === 'CREATING') return [];
    if (this.typingState.get(userId) === isTyping) return [];
    if (this.typingLimiter.take(userId)) return [];
    this.typingState.set(userId, isTyping);
    return [{ kind: 'send', to: this.peerOf(userId).userId, event: { type: 'chat:typing', isTyping } }];
  }

  private onSaveRequest(userId: string): RoomEffect[] {
    const state = this.saveStateFor(userId);
    if (state === 'saved' || state === 'requested_by_me') return [];
    if (state === 'requested_by_peer') return this.onSaveRespond(userId, true);
    if (this.saveLimiter.take(userId)) return this.reject(userId, 'rate_limited', 'You can ask again in a few minutes.');
    this.meta.saveRequestedBy = userId;
    this.meta.saveConsent = [userId];
    this.meta.saveDeclined = false;
    return this.both((u) => ({ type: 'chat:save_state', state: this.saveStateFor(u) }));
  }

  private onSaveRespond(userId: string, accept: boolean): RoomEffect[] {
    if (!this.meta.saveRequestedBy || this.meta.saveRequestedBy === userId || this.meta.saveConsent.length >= 2) return [];
    if (accept) {
      this.meta.saveConsent = [this.meta.saveRequestedBy, userId];
    } else {
      this.meta.saveConsent = [];
      this.meta.saveRequestedBy = null;
      this.meta.saveDeclined = true;
    }
    return this.both((u) => ({ type: 'chat:save_state', state: this.saveStateFor(u) }));
  }

  private onReport(userId: string, reason: ReportReason, details: string, alsoBlock: boolean): RoomEffect[] {
    const reported = this.peerOf(userId).userId;
    // Minimum necessary evidence: the last N messages, labelled by role, no user ids.
    const evidence: EvidenceLine[] = this.messages.slice(-LIMITS.REPORT_EVIDENCE_MESSAGES).map((m) => ({
      from: m.senderId === null ? 'system' : m.senderId === userId ? 'reporter' : 'reported',
      text: m.text,
      ts: m.ts,
    }));
    const out: RoomEffect[] = [
      { kind: 'report', reporterId: userId, reportedId: reported, reason, details, evidence, alsoBlock },
      { kind: 'send', to: userId, event: { type: 'chat:report_ack', blocked: alsoBlock } },
    ];
    if (alsoBlock) out.push(...this.end('blocked', userId));
    return out;
  }

  // ------------------------------------------------------------------ Conversation Quest
  private questGuard(userId: string): RoomEffect[] | null {
    if (this.meta.status === 'CREATING') return this.reject(userId, 'not_active', 'Wait for the stranger to connect.');
    if (this.questLimiter.take(userId)) return this.reject(userId, 'rate_limited', 'Too many quest actions — slow down.');
    return null;
  }

  private onQuestPropose(userId: string, category: QuestCategoryId): RoomEffect[] {
    const g = this.questGuard(userId);
    if (g) return g;
    if (this.meta.quest) return this.reject(userId, 'quest_invalid', 'A quest is already running.');
    this.meta.quest = {
      status: 'proposed',
      category,
      proposedBy: userId,
      round: 0,
      questionId: null,
      answers: {},
      used: [],
      startedAt: this.opts.now(),
    };
    this.meta.questRoundsCompleted = 0;
    return this.questBroadcast();
  }

  private onQuestRespond(userId: string, accept: boolean): RoomEffect[] {
    const g = this.questGuard(userId);
    if (g) return g;
    const q = this.meta.quest;
    if (!q || q.status !== 'proposed' || q.proposedBy === userId) return this.reject(userId, 'quest_invalid', 'No quest invitation to answer.');
    if (!accept) {
      this.meta.quest = null;
      return this.questBroadcast((u) => (u === userId ? undefined : 'The stranger passed on the quest. Maybe later!'));
    }
    this.loadQuestion(q);
    return this.questBroadcast((u) => (u === userId ? undefined : 'Quest accepted — let\'s go!'));
  }

  private loadQuestion(q: QuestInternal): void {
    const next = this.opts.pickQuestion(q.category, q.used);
    q.used.push(next.id);
    q.questionId = next.id;
    q.answers = {};
    q.status = 'active';
    q.round += 1;
  }

  private onQuestAnswer(userId: string, questionId: string, answer: string, guess?: string): RoomEffect[] {
    const g = this.questGuard(userId);
    if (g) return g;
    const q = this.meta.quest;
    if (!q || q.status !== 'active' || q.questionId !== questionId) return this.reject(userId, 'quest_invalid', 'That question is no longer active.');
    if (q.answers[userId]) return this.reject(userId, 'quest_invalid', 'You already answered.');
    const question = this.opts.getQuestion(questionId);
    if (!question) return this.reject(userId, 'quest_invalid', 'Unknown question.');
    if (question.kind !== 'open' && !question.options?.includes(answer)) return this.reject(userId, 'quest_invalid', 'Pick one of the options.');
    if (question.kind === 'guess' && (!guess || !question.options?.includes(guess))) return this.reject(userId, 'quest_invalid', 'Make a guess for your partner too.');
    q.answers[userId] = question.kind === 'guess' ? { answer, guess } : { answer };
    const peer = this.peerOf(userId).userId;
    if (q.answers[peer]) {
      q.status = 'revealed';
      this.meta.questRoundsCompleted += 1;
    }
    return this.questBroadcast();
  }

  private onQuestAdvance(userId: string, skip: boolean): RoomEffect[] {
    const g = this.questGuard(userId);
    if (g) return g;
    const q = this.meta.quest;
    if (!q || q.status === 'proposed') return this.reject(userId, 'quest_invalid', 'No active quest.');
    if (skip && q.status !== 'active') return this.reject(userId, 'quest_invalid', 'Nothing to skip.');
    if (!skip && q.status !== 'revealed') return this.reject(userId, 'quest_invalid', 'Both answers are needed first.');
    this.loadQuestion(q);
    return this.questBroadcast((u) => (u === userId ? undefined : skip ? 'The stranger skipped that question.' : undefined));
  }

  private onQuestEnd(userId: string): RoomEffect[] {
    const q = this.meta.quest;
    if (!q) return [];
    this.meta.quest = null;
    return [
      { kind: 'quest_summary', category: q.category, rounds: this.meta.questRoundsCompleted, startedAt: q.startedAt },
      ...this.questBroadcast((u) => (u === userId ? 'Quest ended. Back to chatting!' : 'The stranger ended the quest.')),
    ];
  }
}
