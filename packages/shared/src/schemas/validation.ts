import {
  AVATAR_STYLES,
  GENDERS,
  LANGUAGE_CODES,
  LIMITS,
  REPORT_REASONS,
  type AvatarStyle,
  type Gender,
  type ReportReason,
} from '../constants/index';

/**
 * Dependency-free validation helpers shared by the browser and the Worker.
 * Every function returns a discriminated Result so callers must handle failures.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T = never>(error: string, field?: string): Result<T> => ({
  ok: false,
  error,
  field,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Count user-perceived characters approximately (code points, so emoji count once-ish). */
export const charCount = (s: string): number => Array.from(s).length;

// Control chars except \n and \t, plus bidi override/isolate characters used for spoofing.
// Zero-width joiner (U+200D) is deliberately preserved because emoji sequences need it.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069\u200B\uFEFF]/g;

/** Normalise and validate free text (chat messages, bios, answers). */
export function sanitizeText(
  input: unknown,
  max: number,
  opts: { allowEmpty?: boolean; singleLine?: boolean } = {},
): Result<string> {
  if (typeof input !== 'string') return fail('must_be_text');
  let s = input.normalize('NFC').replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  if (opts.singleLine) s = s.replace(/\s+/g, ' ');
  s = s.replace(/\n{4,}/g, '\n\n\n').trim();
  if (!s && !opts.allowEmpty) return fail('empty');
  if (charCount(s) > max) return fail('too_long');
  return ok(s);
}

const URL_RE = /\b((?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|gg|me|xyz|ru|ly|co|app|link|info|biz|tk|top|site|online|club|in|de|uk)(?:\/[^\s<>"']*)?)/gi;

export function extractLinks(text: string): string[] {
  return text.match(URL_RE) ?? [];
}
export const containsLink = (text: string): boolean => extractLinks(text).length > 0;

/** Split text into plain and link segments so UIs can render links as *non-clickable* warnings. */
export function segmentLinks(text: string): Array<{ type: 'text' | 'link'; value: string }> {
  const out: Array<{ type: 'text' | 'link'; value: string }> = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ type: 'text', value: text.slice(last, idx) });
    out.push({ type: 'link', value: m[0] });
    last = idx + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Lowercase, collapse whitespace & repeated chars - used for duplicate/flood detection. */
export function floodKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/(.)\1{3,}/g, '$1$1$1')
    .trim();
}

const RESERVED_NAMES = /\b(admin|moderator|mod|staff|support|official|system|talksy|orbitchat)\b/i;

export function validateDisplayName(input: unknown): Result<string> {
  const r = sanitizeText(input, LIMITS.DISPLAY_NAME_MAX, { singleLine: true });
  if (!r.ok) return fail(r.error === 'too_long' ? 'Display name is too long' : 'Display name is required', 'displayName');
  if (charCount(r.value) < LIMITS.DISPLAY_NAME_MIN) return fail('Display name is too short', 'displayName');
  if (RESERVED_NAMES.test(r.value)) return fail('That name is reserved', 'displayName');
  if (containsLink(r.value)) return fail('Links are not allowed in names', 'displayName');
  if (/@/.test(r.value)) return fail('Do not use an email address as your name', 'displayName');
  return r;
}

export function validateInterests(input: unknown): Result<string[]> {
  if (!Array.isArray(input)) return fail('Interests must be a list', 'interests');
  if (input.length > LIMITS.INTERESTS_MAX) return fail(`Pick up to ${LIMITS.INTERESTS_MAX} interests`, 'interests');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const r = sanitizeText(item, LIMITS.INTEREST_MAX_CHARS, { singleLine: true });
    if (!r.ok) return fail('Each interest must be 1-24 characters', 'interests');
    const key = r.value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(r.value);
    }
  }
  return ok(out);
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string;
  interests?: string[];
  language?: string;
  gender?: Gender;
  avatarStyle?: AvatarStyle;
  avatarSeed?: string;
  showGender?: boolean;
  showOnline?: boolean;
  allowMatchRequests?: boolean;
  notifyFriendRequests?: boolean;
  notifyDms?: boolean;
  /** Onboarding confirmations (only meaningful when true). */
  confirmAdult?: boolean;
  acceptTerms?: boolean;
  completeOnboarding?: boolean;
}

const BOOL_KEYS = [
  'showGender',
  'showOnline',
  'allowMatchRequests',
  'notifyFriendRequests',
  'notifyDms',
  'confirmAdult',
  'acceptTerms',
  'completeOnboarding',
] as const;

export function validateProfilePatch(input: unknown): Result<ProfilePatch> {
  if (!isPlainObject(input)) return fail('Invalid body');
  const out: ProfilePatch = {};
  const allowed = new Set<string>([
    'displayName',
    'bio',
    'interests',
    'language',
    'gender',
    'avatarStyle',
    'avatarSeed',
    ...BOOL_KEYS,
  ]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) return fail(`Unknown field: ${key}`, key);

  if (input.displayName !== undefined) {
    const r = validateDisplayName(input.displayName);
    if (!r.ok) return r;
    out.displayName = r.value;
  }
  if (input.bio !== undefined) {
    const r = sanitizeText(input.bio, LIMITS.BIO_MAX, { allowEmpty: true });
    if (!r.ok) return fail(`Bio must be at most ${LIMITS.BIO_MAX} characters`, 'bio');
    out.bio = r.value;
  }
  if (input.interests !== undefined) {
    const r = validateInterests(input.interests);
    if (!r.ok) return r;
    out.interests = r.value;
  }
  if (input.language !== undefined) {
    if (typeof input.language !== 'string' || !LANGUAGE_CODES.includes(input.language))
      return fail('Unsupported language', 'language');
    out.language = input.language;
  }
  if (input.gender !== undefined) {
    if (!GENDERS.includes(input.gender as Gender)) return fail('Invalid gender option', 'gender');
    out.gender = input.gender as Gender;
  }
  if (input.avatarStyle !== undefined) {
    if (!AVATAR_STYLES.includes(input.avatarStyle as AvatarStyle)) return fail('Invalid avatar', 'avatarStyle');
    out.avatarStyle = input.avatarStyle as AvatarStyle;
  }
  if (input.avatarSeed !== undefined) {
    if (typeof input.avatarSeed !== 'string' || !/^[a-z0-9]{4,16}$/i.test(input.avatarSeed))
      return fail('Invalid avatar seed', 'avatarSeed');
    out.avatarSeed = input.avatarSeed;
  }
  for (const key of BOOL_KEYS) {
    const v = input[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') return fail(`${key} must be true or false`, key);
    out[key] = v;
  }
  return ok(out);
}

export interface ReportInput {
  reason: ReportReason;
  details: string;
  context: 'random_chat' | 'dm' | 'profile';
  sessionId?: string;
  messageId?: string;
  targetUserId?: string;
  alsoBlock: boolean;
}

export function validateReportFields(input: Record<string, unknown>): Result<{ reason: ReportReason; details: string }> {
  if (!REPORT_REASONS.includes(input.reason as ReportReason)) return fail('Choose a reason', 'reason');
  const d = sanitizeText(input.details ?? '', LIMITS.REPORT_DETAILS_MAX, { allowEmpty: true });
  if (!d.ok) return fail(`Details must be at most ${LIMITS.REPORT_DETAILS_MAX} characters`, 'details');
  return ok({ reason: input.reason as ReportReason, details: d.value });
}

export function validateReport(input: unknown): Result<ReportInput> {
  if (!isPlainObject(input)) return fail('Invalid body');
  const base = validateReportFields(input);
  if (!base.ok) return base;
  const context = input.context;
  if (context !== 'random_chat' && context !== 'dm' && context !== 'profile') return fail('Invalid context', 'context');
  const out: ReportInput = { ...base.value, context, alsoBlock: input.alsoBlock === true };
  if (context === 'random_chat') {
    if (!isUuid(input.sessionId)) return fail('sessionId required', 'sessionId');
    out.sessionId = input.sessionId;
  } else if (context === 'dm') {
    if (!isUuid(input.messageId)) return fail('messageId required', 'messageId');
    out.messageId = input.messageId;
  } else {
    if (!isUuid(input.targetUserId)) return fail('targetUserId required', 'targetUserId');
    out.targetUserId = input.targetUserId;
  }
  return ok(out);
}

const ADJ = ['Cosmic', 'Lunar', 'Solar', 'Swift', 'Quiet', 'Bright', 'Curious', 'Gentle', 'Nova', 'Stellar', 'Misty', 'Velvet', 'Amber', 'Azure', 'Coral', 'Jade'];
const NOUN = ['Otter', 'Falcon', 'Comet', 'Panda', 'Fox', 'Koala', 'Orbit', 'Lynx', 'Heron', 'Wave', 'Pixel', 'Maple', 'Echo', 'Sparrow', 'Nebula', 'Tiger'];

/** Suggest a friendly anonymous nickname. */
export function suggestNickname(rand: () => number = Math.random): string {
  const a = ADJ[Math.floor(rand() * ADJ.length)];
  const n = NOUN[Math.floor(rand() * NOUN.length)];
  const num = Math.floor(rand() * 90 + 10);
  return `${a}${n}${num}`;
}
