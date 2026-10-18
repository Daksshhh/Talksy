import { LIMITS } from '../constants/index';
import { fail, isPlainObject, isUuid, ok, sanitizeText, validateReportFields, type Result } from './validation';
import type { ReportReason } from '../constants/index';

/**
 * Real-time protocol.
 *
 * Two WebSocket channels exist:
 *  - Lobby socket  (/ws/lobby?ticket=…)       -> MatchCoordinator Durable Object
 *    queue join/leave, presence counts, match notifications, session resume.
 *  - Room socket   (/ws/room/:id?token=…)     -> ChatRoom Durable Object (one per match)
 *    chat messages, typing, save-consent, reports and Conversation Quest.
 *
 * Sender identity is ALWAYS derived server-side from the authenticated socket.
 * Client payloads never contain user IDs; any extra fields are rejected.
 */

// ---------------------------------------------------------------- shared shapes
export interface PeerInfo {
  displayName: string;
  avatarSeed: string;
  avatarStyle: string;
}

export type QuestCategoryId =
  | 'this_or_that'
  | 'would_you_rather'
  | 'two_truths'
  | 'culture'
  | 'icebreakers'
  | 'deep'
  | 'guess';

export const QUEST_CATEGORY_IDS: readonly QuestCategoryId[] = [
  'this_or_that',
  'would_you_rather',
  'two_truths',
  'culture',
  'icebreakers',
  'deep',
  'guess',
];

export type QuestKind = 'choice' | 'open' | 'guess';

export interface QuestQuestionView {
  id: string;
  category: QuestCategoryId;
  kind: QuestKind;
  text: string;
  options?: string[];
  hint?: string;
}

export interface QuestRevealView {
  mine: { answer: string; guess?: string };
  peer: { answer: string; guess?: string };
  /** For 'choice': both chose the same. For 'guess': whether each guessed right. */
  sameChoice?: boolean;
  myGuessCorrect?: boolean;
  peerGuessCorrect?: boolean;
}

export interface QuestView {
  status: 'proposed' | 'active' | 'revealed';
  category: QuestCategoryId;
  proposedBy: 'me' | 'peer';
  round: number;
  question?: QuestQuestionView;
  myAnswered: boolean;
  peerAnswered: boolean;
  reveal?: QuestRevealView;
}

export type SaveState = 'none' | 'requested_by_me' | 'requested_by_peer' | 'saved' | 'declined';

export interface ChatMessageView {
  id: string;
  clientMsgId?: string;
  from: 'me' | 'peer' | 'system';
  text: string;
  ts: number;
  /** True when the server detected a link; clients render it as non-clickable. */
  hasLink?: boolean;
}

export type EndReason =
  | 'left'
  | 'next'
  | 'timeout'
  | 'blocked'
  | 'reported'
  | 'moderation'
  | 'expired'
  | 'error';

// ---------------------------------------------------------------- lobby
export type LobbyClientEvent =
  | { type: 'queue:join' }
  | { type: 'queue:leave' }
  /** Next Stranger: atomically end the current room (if any) and re-enter the queue. */
  | { type: 'queue:next' }
  /** End the current chat without re-queuing. */
  | { type: 'session:end' }
  | { type: 'session:resume' }
  | { type: 'ping' };

export type QueueErrorCode =
  | 'rate_limited'
  | 'already_in_session'
  | 'restricted'
  | 'not_onboarded'
  | 'server_error';

export type LobbyServerEvent =
  | { type: 'hello'; state: 'IDLE' | 'QUEUED' | 'MATCHED'; activeSessionId?: string; online: number; waiting: number }
  | { type: 'queue:waiting'; since: number; position: number; waiting: number }
  | { type: 'queue:matched'; sessionId: string; roomToken: string; peer: PeerInfo; resumed: boolean }
  | { type: 'queue:left' }
  | { type: 'queue:error'; code: QueueErrorCode; message: string; retryAfterMs?: number; sessionId?: string }
  | { type: 'session:none' }
  | { type: 'presence:count'; online: number; waiting: number; inChat: number }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string };

// ---------------------------------------------------------------- room
export type RoomClientEvent =
  | { type: 'chat:send'; clientMsgId: string; text: string }
  | { type: 'chat:typing'; isTyping: boolean }
  | { type: 'chat:leave'; reason: 'left' | 'next' }
  | { type: 'chat:save_request' }
  | { type: 'chat:save_respond'; accept: boolean }
  | { type: 'chat:report'; reason: ReportReason; details: string; alsoBlock: boolean }
  | { type: 'quest:propose'; category: QuestCategoryId }
  | { type: 'quest:respond'; accept: boolean }
  | { type: 'quest:answer'; questionId: string; answer: string; guess?: string }
  | { type: 'quest:next' }
  | { type: 'quest:skip' }
  | { type: 'quest:end' }
  | { type: 'ping' };

export type RoomErrorCode =
  | 'rate_limited'
  | 'flood'
  | 'too_long'
  | 'empty'
  | 'too_many_links'
  | 'not_active'
  | 'invalid'
  | 'quest_invalid';

export type RoomServerEvent =
  | {
      type: 'chat:ready';
      sessionId: string;
      you: PeerInfo;
      peer: PeerInfo;
      peerConnected: boolean;
      startedAt: number;
      messages: ChatMessageView[];
      quest: QuestView | null;
      save: SaveState;
    }
  | { type: 'chat:message'; message: ChatMessageView }
  | { type: 'chat:ack'; clientMsgId: string; id: string; ts: number }
  | { type: 'chat:rejected'; clientMsgId?: string; code: RoomErrorCode; message: string; retryAfterMs?: number }
  | { type: 'chat:typing'; isTyping: boolean }
  | { type: 'chat:peer_status'; status: 'connected' | 'reconnecting' }
  | { type: 'chat:ended'; reason: EndReason; by: 'me' | 'peer' | 'system' }
  | { type: 'chat:save_state'; state: SaveState }
  | { type: 'chat:friend_request'; direction: 'incoming' | 'outgoing'; status: 'pending' | 'accepted' }
  | { type: 'chat:report_ack'; blocked: boolean }
  | { type: 'quest:state'; quest: QuestView | null; notice?: string }
  | { type: 'pong'; ts: number }
  | { type: 'error'; code: string; message: string };

// ---------------------------------------------------------------- parsing
function parseFrame(raw: unknown): Result<Record<string, unknown>> {
  if (typeof raw !== 'string') return fail('binary_not_supported');
  if (raw.length > LIMITS.MAX_WS_FRAME_BYTES) return fail('frame_too_large');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail('invalid_json');
  }
  if (!isPlainObject(data) || typeof data.type !== 'string') return fail('invalid_event');
  return ok(data);
}

function onlyKeys(obj: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(obj).every((k) => k === 'type' || keys.includes(k));
}

export function parseLobbyClientEvent(raw: unknown): Result<LobbyClientEvent> {
  const f = parseFrame(raw);
  if (!f.ok) return f;
  const e = f.value;
  switch (e.type) {
    case 'queue:join':
    case 'queue:leave':
    case 'queue:next':
    case 'session:end':
    case 'session:resume':
    case 'ping':
      if (!onlyKeys(e, [])) return fail('unexpected_fields');
      return ok({ type: e.type } as LobbyClientEvent);
    default:
      return fail('unknown_event');
  }
}

const CLIENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function parseRoomClientEvent(raw: unknown): Result<RoomClientEvent> {
  const f = parseFrame(raw);
  if (!f.ok) return f;
  const e = f.value;
  switch (e.type) {
    case 'chat:send': {
      if (!onlyKeys(e, ['clientMsgId', 'text'])) return fail('unexpected_fields');
      if (typeof e.clientMsgId !== 'string' || !CLIENT_ID_RE.test(e.clientMsgId)) return fail('invalid_client_id');
      if (typeof e.text !== 'string') return fail('invalid_text');
      // Length/emptiness is validated by the room so it can reply with a typed rejection.
      return ok({ type: 'chat:send', clientMsgId: e.clientMsgId, text: e.text });
    }
    case 'chat:typing':
      if (!onlyKeys(e, ['isTyping']) || typeof e.isTyping !== 'boolean') return fail('invalid_typing');
      return ok({ type: 'chat:typing', isTyping: e.isTyping });
    case 'chat:leave':
      if (!onlyKeys(e, ['reason']) || (e.reason !== 'left' && e.reason !== 'next')) return fail('invalid_leave');
      return ok({ type: 'chat:leave', reason: e.reason });
    case 'chat:save_request':
    case 'quest:next':
    case 'quest:skip':
    case 'quest:end':
    case 'ping':
      if (!onlyKeys(e, [])) return fail('unexpected_fields');
      return ok({ type: e.type } as RoomClientEvent);
    case 'chat:save_respond':
    case 'quest:respond':
      if (!onlyKeys(e, ['accept']) || typeof e.accept !== 'boolean') return fail('invalid_response');
      return ok({ type: e.type, accept: e.accept });
    case 'chat:report': {
      if (!onlyKeys(e, ['reason', 'details', 'alsoBlock'])) return fail('unexpected_fields');
      const r = validateReportFields(e);
      if (!r.ok) return r;
      return ok({ type: 'chat:report', ...r.value, alsoBlock: e.alsoBlock === true });
    }
    case 'quest:propose':
      if (!onlyKeys(e, ['category']) || !QUEST_CATEGORY_IDS.includes(e.category as QuestCategoryId))
        return fail('invalid_category');
      return ok({ type: 'quest:propose', category: e.category as QuestCategoryId });
    case 'quest:answer': {
      if (!onlyKeys(e, ['questionId', 'answer', 'guess'])) return fail('unexpected_fields');
      if (typeof e.questionId !== 'string' || e.questionId.length > 64) return fail('invalid_question');
      const a = sanitizeText(e.answer, LIMITS.QUEST_ANSWER_MAX);
      if (!a.ok) return fail('invalid_answer');
      let guess: string | undefined;
      if (e.guess !== undefined) {
        const g = sanitizeText(e.guess, LIMITS.QUEST_ANSWER_MAX);
        if (!g.ok) return fail('invalid_guess');
        guess = g.value;
      }
      return ok({ type: 'quest:answer', questionId: e.questionId, answer: a.value, guess });
    }
    default:
      return fail('unknown_event');
  }
}

export { isUuid };
