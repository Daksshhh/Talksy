import {
  isPlainObject,
  isUuid,
  validateReport,
  type FriendRequestView,
  type FriendSummary,
  type HistoryDetail,
  type HistoryItem,
  type PresenceStatus,
} from '@orbit/shared';
import type { Ctx } from '../router';
import { assertNotRestricted, db, limitWrites, requireUser } from '../middleware/auth';
import { HttpError, badRequest, json, notFound, readJson } from '../http';
import { verifyTurnstile } from '../services/turnstile';
import { coordinator, room } from '../services/coordinator';

interface MiniProfile {
  id: string;
  display_name: string;
  avatar_seed: string;
  avatar_style: string;
}

async function profilesByIds(ctx: Ctx, ids: string[]): Promise<Map<string, MiniProfile>> {
  const uniq = [...new Set(ids)].filter(isUuid);
  if (!uniq.length) return new Map();
  const rows = await db(ctx.env).select<MiniProfile>('profiles', `select=id,display_name,avatar_seed,avatar_style&id=in.(${uniq.join(',')})`);
  return new Map(rows.map((r) => [r.id, r]));
}

const mini = (p: MiniProfile | undefined, id: string) => ({
  userId: id,
  displayName: p?.display_name ?? 'Deleted user',
  avatarSeed: p?.avatar_seed ?? 'deleted',
  avatarStyle: (p?.avatar_style ?? 'orbit') as FriendSummary['avatarStyle'],
});

// ------------------------------------------------------------------ friends
export async function listFriends(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const d = db(ctx.env);
  const rows = await d.select<{ user_a: string; user_b: string; created_at: string }>(
    'friendships',
    `select=user_a,user_b,created_at&or=(user_a.eq.${user.id},user_b.eq.${user.id})&order=created_at.desc&limit=500`,
  );
  const otherIds = rows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a));
  const [profiles, convs] = await Promise.all([
    profilesByIds(ctx, otherIds),
    d.select<{ id: string; user_a: string; user_b: string }>(
      'direct_conversations',
      `select=id,user_a,user_b&or=(user_a.eq.${user.id},user_b.eq.${user.id})&limit=500`,
    ),
  ]);
  const convByPeer = new Map(convs.map((c) => [c.user_a === user.id ? c.user_b : c.user_a, c.id]));
  const items: FriendSummary[] = rows.map((r) => {
    const other = r.user_a === user.id ? r.user_b : r.user_a;
    return { ...mini(profiles.get(other), other), since: r.created_at, conversationId: convByPeer.get(other) ?? null };
  });
  return json({ items });
}

export async function removeFriend(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  if (!isUuid(ctx.params.userId)) throw badRequest('Invalid user id');
  await db(ctx.env).rpc('remove_friend', { p_actor: user.id, p_other: ctx.params.userId });
  return json({ ok: true });
}

export async function listFriendRequests(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const rows = await db(ctx.env).select<{
    id: string;
    sender_id: string;
    recipient_id: string;
    status: FriendRequestView['status'];
    created_at: string;
    session_id: string | null;
  }>(
    'friend_requests',
    `select=id,sender_id,recipient_id,status,created_at,session_id&or=(sender_id.eq.${user.id},recipient_id.eq.${user.id})&status=eq.pending&order=created_at.desc&limit=200`,
  );
  const profiles = await profilesByIds(ctx, rows.map((r) => (r.sender_id === user.id ? r.recipient_id : r.sender_id)));
  const items: FriendRequestView[] = rows.map((r) => {
    const outgoing = r.sender_id === user.id;
    const other = outgoing ? r.recipient_id : r.sender_id;
    return {
      id: r.id,
      direction: outgoing ? 'outgoing' : 'incoming',
      status: r.status,
      createdAt: r.created_at,
      other: mini(profiles.get(other), other),
      sessionId: r.session_id,
    };
  });
  return json({ items });
}

export async function createFriendRequest(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  const body = await readJson(ctx.req);
  if (!isPlainObject(body) || !isUuid(body.sessionId)) throw badRequest('sessionId is required', 'sessionId');
  const result = await db(ctx.env).rpc<{ id: string; status: 'pending' | 'accepted'; conversationId?: string }>('send_friend_request', {
    p_actor: user.id,
    p_session: body.sessionId,
  });
  // Let a live room show the request instantly (best-effort; notification is the durable path).
  ctx.exec.waitUntil(
    room(ctx.env, body.sessionId)
      .fetch('https://room/internal/event', { method: 'POST', body: JSON.stringify({ type: 'friend_request', from: user.id, status: result.status }) })
      .then((r) => r.body?.cancel())
      .catch(() => undefined),
  );
  return json({ id: result.id, status: result.status, conversationId: result.conversationId ?? null }, 201);
}

export async function respondFriendRequest(ctx: Ctx, accept: boolean): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  if (!isUuid(ctx.params.id)) throw badRequest('Invalid request id');
  const r = await db(ctx.env).rpc<{ id: string; status: string; conversationId?: string }>('respond_friend_request', {
    p_actor: user.id,
    p_request: ctx.params.id,
    p_accept: accept,
  });
  return json(r);
}

export async function cancelFriendRequest(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  if (!isUuid(ctx.params.id)) throw badRequest('Invalid request id');
  return json(await db(ctx.env).rpc('cancel_friend_request', { p_actor: user.id, p_request: ctx.params.id }));
}

// ------------------------------------------------------------------ history
export async function listHistory(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const before = ctx.url.searchParams.get('before');
  if (before && Number.isNaN(Date.parse(before))) throw badRequest('Invalid cursor');
  const limit = 20;
  const items = await db(ctx.env).rpc<HistoryItem[]>('get_history', { p_actor: user.id, p_before: before, p_limit: limit });
  return json({ items, nextCursor: items.length === limit ? items[items.length - 1].startedAt : null });
}

export async function getHistoryItem(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const id = ctx.params.sessionId;
  if (!isUuid(id)) throw badRequest('Invalid session id');
  const d = db(ctx.env);
  const me = await d.selectOne<{ session_id: string }>('random_chat_participants', `select=session_id&session_id=eq.${id}&user_id=eq.${user.id}&hidden_at=is.null`);
  if (!me) throw notFound('History item not found');
  const session = await d.selectOne<{ started_at: string }>('random_chat_sessions', `select=started_at&id=eq.${id}`);
  // Reuse the list function with a cursor just after this session to get identical computed fields.
  const cursor = new Date(Date.parse(session!.started_at) + 1).toISOString();
  const items = await d.rpc<HistoryItem[]>('get_history', { p_actor: user.id, p_before: cursor, p_limit: 5 });
  const item = items.find((i) => i.sessionId === id);
  if (!item) throw notFound('History item not found');
  const transcript = await d.rpc<HistoryDetail['transcript']>('get_history_transcript', { p_actor: user.id, p_session: id });
  let expires: string | null = null;
  if (transcript && transcript.length) {
    const first = await d.selectOne<{ created_at: string }>('saved_random_messages', `select=created_at&session_id=eq.${id}&order=created_at.asc`);
    if (first) expires = new Date(Date.parse(first.created_at) + 90 * 86_400_000).toISOString();
  }
  const detail: HistoryDetail = { ...item, transcript: transcript ?? null, transcriptExpiresAt: expires };
  return json(detail);
}

export async function hideHistoryItem(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  if (!isUuid(ctx.params.sessionId)) throw badRequest('Invalid session id');
  await db(ctx.env).rpc('hide_history_item', { p_actor: user.id, p_session: ctx.params.sessionId });
  return json({ ok: true });
}

export async function revokeTranscript(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  if (!isUuid(ctx.params.sessionId)) throw badRequest('Invalid session id');
  await db(ctx.env).rpc('revoke_transcript', { p_actor: user.id, p_session: ctx.params.sessionId });
  return json({ ok: true });
}

// ------------------------------------------------------------------ safety
export async function createReport(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  const parsed = validateReport(await readJson(ctx.req));
  if (!parsed.ok) throw badRequest(parsed.error, parsed.field);
  const r = parsed.value;
  const d = db(ctx.env);
  const id = await d.rpc<string>('create_report', {
    p_actor: user.id,
    p_reason: r.reason,
    p_details: r.details,
    p_context: r.context,
    p_session: r.sessionId ?? null,
    p_message: r.messageId ?? null,
    p_target: r.targetUserId ?? null,
    p_evidence: null,
  });
  let blocked = false;
  if (r.alsoBlock) {
    const target = await resolveTarget(ctx, user.id, { sessionId: r.sessionId, messageId: r.messageId, userId: r.targetUserId });
    if (target) {
      await blockAndPropagate(ctx, user.id, target);
      blocked = true;
    }
  }
  return json({ id, blocked }, 201);
}

async function resolveTarget(ctx: Ctx, me: string, ref: { sessionId?: string; messageId?: string; userId?: string }): Promise<string | null> {
  const d = db(ctx.env);
  if (ref.userId) return ref.userId;
  if (ref.sessionId) return d.rpc<string | null>('session_peer', { p_actor: me, p_session: ref.sessionId });
  if (ref.messageId) {
    const m = await d.selectOne<{ sender_id: string; conversation_id: string }>('direct_messages', `select=sender_id,conversation_id&id=eq.${ref.messageId}`);
    if (!m) return null;
    const member = await d.rpc<boolean>('is_conversation_member', { p_conversation: m.conversation_id, p_user: me });
    return member && m.sender_id !== me ? m.sender_id : null;
  }
  return null;
}

async function blockAndPropagate(ctx: Ctx, me: string, target: string): Promise<void> {
  await db(ctx.env).rpc('block_user', { p_actor: me, p_target: target });
  // Ends any live random chat between them and prevents future matches immediately.
  await coordinator(ctx.env)
    .fetch('https://coord/internal/block', { method: 'POST', body: JSON.stringify({ a: me, b: target }) })
    .then((r) => r.body?.cancel())
    .catch(() => undefined);
}

export async function createBlock(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  const body = await readJson(ctx.req);
  if (!isPlainObject(body)) throw badRequest('Invalid body');
  const ref = {
    userId: isUuid(body.userId) ? body.userId : undefined,
    sessionId: isUuid(body.sessionId) ? body.sessionId : undefined,
  };
  if (!ref.userId && !ref.sessionId) throw badRequest('userId or sessionId required');
  const target = await resolveTarget(ctx, user.id, ref);
  if (!target) throw notFound('User not found');
  await blockAndPropagate(ctx, user.id, target);
  return json({ ok: true }, 201);
}

export async function listBlocks(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const rows = await db(ctx.env).select<{ blocked_id: string; created_at: string }>(
    'user_blocks',
    `select=blocked_id,created_at&blocker_id=eq.${user.id}&order=created_at.desc&limit=500`,
  );
  const profiles = await profilesByIds(ctx, rows.map((r) => r.blocked_id));
  return json({ items: rows.map((r) => ({ ...mini(profiles.get(r.blocked_id), r.blocked_id), blockedAt: r.created_at })) });
}

export async function deleteBlock(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  if (!isUuid(ctx.params.userId)) throw badRequest('Invalid user id');
  await db(ctx.env).rpc('unblock_user', { p_actor: user.id, p_target: ctx.params.userId });
  return json({ ok: true });
}

// ------------------------------------------------------------------ presence
let countCache: { at: number; body: unknown } | null = null;

export async function presenceCount(ctx: Ctx): Promise<Response> {
  if (!countCache || Date.now() - countCache.at > 10_000) {
    const r = await coordinator(ctx.env).fetch('https://coord/internal/stats');
    const s = (await r.json()) as { online: number; waiting: number; inChat: number };
    countCache = { at: Date.now(), body: { online: s.online, waiting: s.waiting, inChat: s.inChat, approximate: true, updatedAt: Date.now() } };
  }
  return json(countCache.body, 200, { 'Cache-Control': 'public, max-age=10' });
}

export async function friendsPresence(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const d = db(ctx.env);
  const rows = await d.select<{ user_a: string; user_b: string }>('friendships', `select=user_a,user_b&or=(user_a.eq.${user.id},user_b.eq.${user.id})&limit=500`);
  const ids = rows.map((r) => (r.user_a === user.id ? r.user_b : r.user_a));
  const out: Record<string, PresenceStatus> = {};
  if (!ids.length) return json({ presence: out });
  const prefs = await d.select<{ user_id: string; show_online: boolean }>('user_preferences', `select=user_id,show_online&user_id=in.(${ids.join(',')})`);
  const visible = prefs.filter((p) => p.show_online).map((p) => p.user_id);
  for (const id of ids) out[id] = 'hidden';
  if (visible.length) {
    const r = await coordinator(ctx.env).fetch('https://coord/internal/presence', { method: 'POST', body: JSON.stringify({ ids: visible }) });
    const live = (await r.json()) as Record<string, PresenceStatus>;
    for (const id of visible) out[id] = live[id] ?? 'unknown';
  }
  return json({ presence: out, approximate: true });
}

// ------------------------------------------------------------------ realtime ticket
export async function issueTicket(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const d = db(ctx.env);
  await assertNotRestricted(d, user.id);
  if (ctx.env.REQUIRE_TURNSTILE === 'true' && user.isAnonymous && ctx.env.TURNSTILE_SECRET_KEY) {
    const ok = await verifyTurnstile(ctx.env.TURNSTILE_SECRET_KEY, ctx.req.headers.get('X-Turnstile-Token'), ctx.req.headers.get('CF-Connecting-IP'));
    if (!ok) throw badRequest('Human verification failed. Please try again.', 'turnstile');
  }
  const [profile, prefs, blocksOut, blocksIn] = await Promise.all([
    d.selectOne<MiniProfile>('profiles', `select=id,display_name,avatar_seed,avatar_style&id=eq.${user.id}`),
    d.selectOne<{ onboarded_at: string | null }>('user_preferences', `select=onboarded_at&user_id=eq.${user.id}`),
    d.select<{ blocked_id: string }>('user_blocks', `select=blocked_id&blocker_id=eq.${user.id}&limit=5000`),
    d.select<{ blocker_id: string }>('user_blocks', `select=blocker_id&blocked_id=eq.${user.id}&limit=5000`),
  ]);
  if (!profile) throw notFound('Profile not found');
  if (!prefs?.onboarded_at) {
    throw new HttpError(403, 'not_onboarded', 'Please finish onboarding first.');
  }
  const r = await coordinator(ctx.env).fetch('https://coord/internal/ticket', {
    method: 'POST',
    body: JSON.stringify({
      userId: user.id,
      // Only what's needed to introduce strangers. No demographic data is passed to matchmaking.
      profile: { displayName: profile.display_name, avatarSeed: profile.avatar_seed, avatarStyle: profile.avatar_style },
      blocked: [...blocksOut.map((b) => b.blocked_id), ...blocksIn.map((b) => b.blocker_id)],
    }),
  });
  if (r.status === 429) {
    const b = (await r.json()) as { retryAfterMs?: number };
    throw new HttpError(429, 'rate_limited', 'Too many connection attempts. Please wait a moment.', undefined, b.retryAfterMs);
  }
  if (!r.ok) throw new Error(`ticket ${r.status}`);
  const t = (await r.json()) as { ticket: string; expiresAt: number };
  const wsBase = new URL(ctx.req.url);
  wsBase.protocol = wsBase.protocol === 'https:' ? 'wss:' : 'ws:';
  return json({ ticket: t.ticket, expiresAt: t.expiresAt, wsUrl: `${wsBase.origin}/ws/lobby` });
}
