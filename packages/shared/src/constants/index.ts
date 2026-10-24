export const LIMITS = {
  /** Stranger chat message length in Unicode code points. */
  MESSAGE_MAX_CHARS: 1000,
  DM_MAX_CHARS: 2000,
  DISPLAY_NAME_MIN: 2,
  DISPLAY_NAME_MAX: 24,
  BIO_MAX: 280,
  INTERESTS_MAX: 8,
  INTEREST_MAX_CHARS: 24,
  REPORT_DETAILS_MAX: 1000,
  QUEST_ANSWER_MAX: 280,
  MAX_WS_FRAME_BYTES: 8 * 1024,
  MAX_LINKS_PER_MESSAGE: 3,
  /** Single-use lobby ticket lifetime. */
  TICKET_TTL_MS: 30_000,
  /** Room join token lifetime (fresh token issued on every resume). */
  ROOM_TOKEN_TTL_MS: 60_000,
  /** How long a room waits for a dropped participant before ending. */
  RECONNECT_GRACE_MS: 30_000,
  /** Client heartbeat interval for lobby + room sockets. */
  HEARTBEAT_MS: 20_000,
  /** A queued/online user without a heartbeat for this long is considered gone. */
  STALE_CONNECTION_MS: 65_000,
  /** In-room message buffer (for reconnect restore / consented saving / report evidence). */
  ROOM_BUFFER_MAX: 300,
  TESTING_CHAT_RETENTION_DAYS: 30,
  REPORT_EVIDENCE_MESSAGES: 30,
  FRIEND_REQUEST_DECLINE_COOLDOWN_HOURS: 72,
  SAVED_TRANSCRIPT_RETENTION_DAYS: 90,
  REPORT_EVIDENCE_RETENTION_DAYS: 90,
  RANDOM_HISTORY_RETENTION_DAYS: 180,
  ENDED_ROOM_TOMBSTONE_MS: 10 * 60_000,
  FLOOD_DUPLICATE_WINDOW_MS: 30_000,
  FLOOD_DUPLICATE_MAX: 2,
  ABUSE_STRIKES_BEFORE_KICK: 12,
  DM_PAGE_SIZE: 30,
  HISTORY_PAGE_SIZE: 20,
} as const;

export interface RateRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  chatMessage: { limit: 8, windowMs: 5_000 },
  typing: { limit: 30, windowMs: 10_000 },
  queueJoin: { limit: 25, windowMs: 60_000 },
  next: { limit: 40, windowMs: 5 * 60_000 },
  nextMinGapMs: 1_200,
  ticket: { limit: 20, windowMs: 60_000 },
  quest: { limit: 30, windowMs: 60_000 },
  saveRequest: { limit: 3, windowMs: 5 * 60_000 },
  report: { limit: 10, windowMs: 60 * 60_000 },
  restWrite: { limit: 60, windowMs: 60_000 },
} as const;

export const GENDERS = ['male', 'female', 'non_binary', 'prefer_not_to_say'] as const;
export type Gender = (typeof GENDERS)[number];
export const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
};

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'bn', label: 'বাংলা' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ' },
  { code: 'mr', label: 'मराठी' },
  { code: 'ar', label: 'العربية' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'ru', label: 'Русский' },
  { code: 'uk', label: 'Українська' },
  { code: 'pl', label: 'Polski' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'tl', label: 'Filipino' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ไทย' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'other', label: 'Other' },
] as const;
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as readonly string[];

export const REPORT_REASONS = [
  'harassment',
  'hate',
  'spam',
  'sexual_misconduct',
  'threats',
  'suspected_minor',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: 'Harassment',
  hate: 'Hate or abusive language',
  spam: 'Spam',
  sexual_misconduct: 'Sexual misconduct',
  threats: 'Threats',
  suspected_minor: 'Suspected minor',
  other: 'Other',
};

export const AVATAR_STYLES = ['orbit', 'nebula', 'comet', 'aurora', 'pulse', 'prism'] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'dm',
  'safety',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const FRIEND_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

/** Suggested opening lines shown before/at the start of a chat. */
export const CONVERSATION_STARTERS = [
  'What is something small that made you smile today?',
  'If you could teleport anywhere right now, where would you go?',
  'What are you listening to lately?',
  'What is a hobby you would love to get into?',
  'Best snack of all time — go.',
  'What is the most interesting thing you learned this week?',
] as const;
