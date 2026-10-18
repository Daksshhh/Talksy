import type { AvatarStyle, FriendRequestStatus, Gender, NotificationType, ReportReason } from '../constants/index';

/** Uniform REST envelope. Errors always use { error: { code, message, field? } }. */
export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; field?: string; retryAfterMs?: number };
}
export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'restricted'
  | 'cooldown'
  | 'blocked'
  | 'not_onboarded'
  | 'server_error'
  | 'unavailable';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MyProfile {
  id: string;
  publicId: string;
  displayName: string;
  avatarSeed: string;
  avatarStyle: AvatarStyle;
  bio: string;
  interests: string[];
  language: string;
  gender: Gender;
  createdAt: string;
  isAnonymous: boolean;
  /** Linked providers such as "google"; email is never exposed to other users. */
  providers: string[];
  isAdmin: boolean;
  friendsCount: number;
  restriction: { kind: 'suspend' | 'ban'; until: string | null; reason: string } | null;
  preferences: {
    showGender: boolean;
    showOnline: boolean;
    allowMatchRequests: boolean;
    notifyFriendRequests: boolean;
    notifyDms: boolean;
  };
  onboarded: boolean;
}

export interface PublicProfile {
  id: string;
  publicId: string;
  displayName: string;
  avatarSeed: string;
  avatarStyle: AvatarStyle;
  bio: string;
  interests: string[];
  language: string;
  /** null when the user keeps gender private. */
  gender: Gender | null;
  createdAt: string;
  friendsCount: number | null;
  isFriend: boolean;
  isBlockedByMe: boolean;
}

export type PresenceStatus = 'online' | 'in_chat' | 'searching' | 'offline' | 'hidden' | 'unknown';

export interface FriendSummary {
  userId: string;
  displayName: string;
  avatarSeed: string;
  avatarStyle: AvatarStyle;
  since: string;
  conversationId: string | null;
}

export interface FriendRequestView {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: FriendRequestStatus;
  createdAt: string;
  other: { userId: string; displayName: string; avatarSeed: string; avatarStyle: AvatarStyle };
  sessionId: string | null;
}

export interface HistoryItem {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  durationSec: number | null;
  status: string;
  endReason: string | null;
  myName: string;
  strangerName: string;
  strangerAvatarSeed: string;
  friendRequestSent: boolean;
  becameFriends: boolean;
  transcriptSaved: boolean;
  canSendFriendRequest: boolean;
}

export interface SavedMessage {
  id: string;
  from: 'me' | 'peer';
  text: string;
  ts: string;
}

export interface HistoryDetail extends HistoryItem {
  transcript: SavedMessage[] | null;
  transcriptExpiresAt: string | null;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface RealtimeTicketResponse {
  ticket: string;
  expiresAt: number;
  wsUrl: string;
}

export interface PresenceCountResponse {
  online: number;
  waiting: number;
  inChat: number;
  /** Counts are approximate (heartbeat based, ~1 min resolution). */
  approximate: true;
  updatedAt: number;
}

export interface CreateReportBody {
  reason: ReportReason;
  details?: string;
  context: 'random_chat' | 'dm' | 'profile';
  sessionId?: string;
  messageId?: string;
  targetUserId?: string;
  alsoBlock?: boolean;
}

export interface AdminReport {
  id: string;
  createdAt: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  reason: ReportReason;
  context: string;
  details: string;
  reporter: { id: string; displayName: string };
  reported: { id: string; displayName: string; openReports: number; restriction: string | null };
  sessionId: string | null;
  messageId: string | null;
  evidence: unknown;
  evidenceExpiresAt: string | null;
  resolution: string | null;
}

export interface AdminMetrics {
  online: number;
  waiting: number;
  inChat: number;
  reportsOpen: number;
  reports24h: number;
  sessions24h: number;
  avgSessionSec24h: number | null;
  activeRestrictions: number;
  safetyEvents24h: number;
  matchStats: { matches: number; joins: number; avgWaitMs: number | null; disconnects: number; wsErrors: number };
}
