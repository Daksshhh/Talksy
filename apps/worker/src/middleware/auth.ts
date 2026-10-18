import type { Env } from '../env';
import { bearerToken, verifySupabaseJwt, type AuthUser } from '../auth/jwt';
import { HttpError, unauthorized } from '../http';
import { Db } from '../services/db';
import { SlidingWindowLimiter } from '../lib/rateLimiter';
import { RATE_LIMITS } from '@orbit/shared';

export async function requireUser(req: Request, env: Env): Promise<AuthUser> {
  const token = bearerToken(req);
  if (!token) throw unauthorized();
  return verifySupabaseJwt(token, {
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: env.SUPABASE_JWT_SECRET,
  });
}

export function db(env: Env): Db {
  return new Db(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export interface Restriction {
  kind: 'suspend' | 'ban';
  ends_at: string | null;
  reason: string;
}

export async function getRestriction(d: Db, userId: string): Promise<Restriction | null> {
  const rows = await d.rpc<Restriction[]>('active_restriction', { p_user: userId });
  return rows?.[0] ?? null;
}

export async function assertNotRestricted(d: Db, userId: string): Promise<void> {
  const r = await getRestriction(d, userId);
  if (r) {
    throw new HttpError(403, 'restricted', r.kind === 'ban' ? 'Your account has been banned.' : `Your account is suspended${r.ends_at ? ` until ${new Date(r.ends_at).toUTCString()}` : ''}.`);
  }
}

export async function requireAdmin(d: Db, userId: string): Promise<void> {
  const ok = await d.rpc<boolean>('is_admin', { p_user: userId });
  if (ok !== true) throw new HttpError(403, 'forbidden', 'Admin access required');
}

// Per-isolate write limiter (approximate across the edge; DB functions enforce hard limits).
const writeLimiter = new SlidingWindowLimiter(RATE_LIMITS.restWrite.limit, RATE_LIMITS.restWrite.windowMs);
export function limitWrites(userId: string): void {
  const wait = writeLimiter.take(userId);
  if (wait) throw new HttpError(429, 'rate_limited', 'Too many requests. Please slow down.', undefined, wait);
}
