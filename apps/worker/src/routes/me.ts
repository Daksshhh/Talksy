import { BRAND, isUuid, validateProfilePatch, type MyProfile, type PublicProfile } from '@orbit/shared';
import type { Ctx } from '../router';
import { assertNotRestricted, db, getRestriction, limitWrites, requireUser } from '../middleware/auth';
import { badRequest, json, notFound, readJson } from '../http';
import { coordinator } from '../services/coordinator';
import { log, shortId } from '../services/logger';

interface ProfileRow {
  id: string;
  public_id: string;
  display_name: string;
  avatar_seed: string;
  avatar_style: string;
  bio: string;
  interests: string[];
  language: string;
  public_gender: string | null;
  created_at: string;
}
interface PrefsRow {
  gender: string;
  show_gender: boolean;
  show_online: boolean;
  allow_match_requests: boolean;
  notify_friend_requests: boolean;
  notify_dms: boolean;
  age_confirmed_at: string | null;
  terms_accepted_at: string | null;
  onboarded_at: string | null;
}

async function friendsCount(ctx: Ctx, userId: string): Promise<number> {
  const d = db(ctx.env);
  return d.count('friendships', `or=(user_a.eq.${userId},user_b.eq.${userId})`);
}

export async function loadMe(ctx: Ctx, userId: string, isAnonymous: boolean): Promise<MyProfile> {
  const d = db(ctx.env);
  const [profile, prefs, authUser, isAdmin, restriction, fc] = await Promise.all([
    d.selectOne<ProfileRow>('profiles', `select=*&id=eq.${userId}`),
    d.selectOne<PrefsRow>('user_preferences', `select=*&user_id=eq.${userId}`),
    d.getAuthUser(userId),
    d.rpc<boolean>('is_admin', { p_user: userId }),
    getRestriction(d, userId),
    friendsCount(ctx, userId),
  ]);
  if (!profile || !prefs) throw notFound('Profile not found');
  return {
    id: profile.id,
    publicId: profile.public_id,
    displayName: profile.display_name,
    avatarSeed: profile.avatar_seed,
    avatarStyle: profile.avatar_style as MyProfile['avatarStyle'],
    bio: profile.bio,
    interests: profile.interests ?? [],
    language: profile.language,
    gender: prefs.gender as MyProfile['gender'],
    createdAt: profile.created_at,
    isAnonymous: authUser?.is_anonymous ?? isAnonymous,
    providers: [...new Set((authUser?.identities ?? []).map((i) => i.provider))],
    isAdmin: isAdmin === true,
    friendsCount: fc,
    restriction: restriction ? { kind: restriction.kind, until: restriction.ends_at, reason: restriction.reason } : null,
    preferences: {
      showGender: prefs.show_gender,
      showOnline: prefs.show_online,
      allowMatchRequests: prefs.allow_match_requests,
      notifyFriendRequests: prefs.notify_friend_requests,
      notifyDms: prefs.notify_dms,
    },
    onboarded: !!prefs.onboarded_at,
  };
}

export async function getMe(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  return json(await loadMe(ctx, user.id, user.isAnonymous));
}

export async function patchMe(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  const parsed = validateProfilePatch(await readJson(ctx.req));
  if (!parsed.ok) throw badRequest(parsed.error, parsed.field);
  const p = parsed.value;
  const d = db(ctx.env);
  // Banned users may still read/delete their data, but not change their public profile.
  if (p.displayName !== undefined || p.bio !== undefined || p.interests !== undefined) await assertNotRestricted(d, user.id);

  const profilePatch: Record<string, unknown> = {};
  if (p.displayName !== undefined) profilePatch.display_name = p.displayName;
  if (p.bio !== undefined) profilePatch.bio = p.bio;
  if (p.interests !== undefined) profilePatch.interests = p.interests;
  if (p.language !== undefined) profilePatch.language = p.language;
  if (p.avatarStyle !== undefined) profilePatch.avatar_style = p.avatarStyle;
  if (p.avatarSeed !== undefined) profilePatch.avatar_seed = p.avatarSeed;

  const prefsPatch: Record<string, unknown> = {};
  if (p.gender !== undefined) prefsPatch.gender = p.gender;
  if (p.showGender !== undefined) prefsPatch.show_gender = p.showGender;
  if (p.showOnline !== undefined) prefsPatch.show_online = p.showOnline;
  if (p.allowMatchRequests !== undefined) prefsPatch.allow_match_requests = p.allowMatchRequests;
  if (p.notifyFriendRequests !== undefined) prefsPatch.notify_friend_requests = p.notifyFriendRequests;
  if (p.notifyDms !== undefined) prefsPatch.notify_dms = p.notifyDms;
  const now = new Date().toISOString();
  if (p.confirmAdult === true) prefsPatch.age_confirmed_at = now;
  if (p.acceptTerms === true) {
    prefsPatch.terms_accepted_at = now;
    prefsPatch.terms_version = BRAND.termsVersion;
  }

  if (p.completeOnboarding === true) {
    const prefs = await d.selectOne<PrefsRow>('user_preferences', `select=*&user_id=eq.${user.id}`);
    const adult = prefs?.age_confirmed_at || p.confirmAdult === true;
    const terms = prefs?.terms_accepted_at || p.acceptTerms === true;
    if (!adult) throw badRequest('You must confirm you are 18 or older', 'confirmAdult');
    if (!terms) throw badRequest('You must accept the Terms and Privacy Policy', 'acceptTerms');
    if (!prefs?.onboarded_at) prefsPatch.onboarded_at = now;
  }

  if (Object.keys(profilePatch).length) await d.update('profiles', `id=eq.${user.id}`, profilePatch);
  if (Object.keys(prefsPatch).length) await d.update('user_preferences', `user_id=eq.${user.id}`, prefsPatch);
  return json(await loadMe(ctx, user.id, user.isAnonymous));
}

export async function deleteMe(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const body = (await readJson(ctx.req)) as { confirm?: string };
  if (body.confirm !== 'DELETE') throw badRequest('Type DELETE to confirm', 'confirm');
  // End live sessions first so the stranger is notified, then delete the auth user (cascades).
  await coordinator(ctx.env)
    .fetch('https://coord/internal/evict', { method: 'POST', body: JSON.stringify({ userId: user.id, reason: 'Account deleted' }) })
    .catch(() => undefined);
  await db(ctx.env).deleteAuthUser(user.id);
  log('info', 'account_deleted', { user: shortId(user.id) });
  return json({ ok: true });
}

export async function exportMe(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  limitWrites(user.id);
  const data = await db(ctx.env).rpc<unknown>('export_my_data', { p_actor: user.id });
  return json(data, 200, { 'Content-Disposition': 'attachment; filename="talksy-data-export.json"' });
}

export async function getPublicProfile(ctx: Ctx): Promise<Response> {
  const user = await requireUser(ctx.req, ctx.env);
  const id = ctx.params.userId;
  if (!isUuid(id)) throw badRequest('Invalid user id');
  const d = db(ctx.env);
  const [isFriend, blocked] = await Promise.all([
    d.rpc<boolean>('are_friends', { a: user.id, b: id }),
    d.selectOne<{ blocker_id: string }>('user_blocks', `select=blocker_id&blocker_id=eq.${user.id}&blocked_id=eq.${id}`),
  ]);
  // Profiles are only visible to yourself and friends (no public discovery of strangers).
  if (id !== user.id && !isFriend) throw notFound('Profile not available');
  const p = await d.selectOne<ProfileRow>('profiles', `select=*&id=eq.${id}`);
  if (!p) throw notFound('Profile not available');
  const out: PublicProfile = {
    id: p.id,
    publicId: p.public_id,
    displayName: p.display_name,
    avatarSeed: p.avatar_seed,
    avatarStyle: p.avatar_style as PublicProfile['avatarStyle'],
    bio: p.bio,
    interests: p.interests ?? [],
    language: p.language,
    gender: (p.public_gender as PublicProfile['gender']) ?? null,
    createdAt: p.created_at,
    friendsCount: await friendsCount(ctx, id),
    isFriend: isFriend === true,
    isBlockedByMe: !!blocked,
  };
  return json(out);
}
