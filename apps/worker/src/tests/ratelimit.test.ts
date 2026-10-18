import { describe, it, expect } from 'vitest';
import { SlidingWindowLimiter } from '../lib/rateLimiter';
import { mapDbError } from '../services/db';

describe('rate limiter', () => {
  it('allows up to the limit within the window, then reports wait time', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(3, 1000, () => t);
    expect([l.take('u'), l.take('u'), l.take('u')]).toEqual([0, 0, 0]);
    const wait = l.take('u');
    expect(wait).toBeGreaterThan(0);
    expect(l.take('other')).toBe(0);
    t = 1001;
    expect(l.take('u')).toBe(0);
  });
});

describe('database error mapping', () => {
  it('maps custom SQL error codes to typed HTTP errors', () => {
    expect(mapDbError(400, { code: 'P0001', message: 'cooldown:Please wait' }, 'x')).toMatchObject({ status: 429, code: 'cooldown' });
    expect(mapDbError(400, { code: 'P0001', message: 'blocked:nope' }, 'x')).toMatchObject({ status: 403, code: 'blocked' });
    expect(mapDbError(400, { code: 'P0001', message: 'conflict:Request already sent' }, 'x')).toMatchObject({ status: 409 });
    expect(mapDbError(409, { code: '23505' }, 'x')).toMatchObject({ status: 409, code: 'conflict' });
  });
});

import { Db } from '../services/db';

describe('Supabase server key handling', () => {
  it('sends sb_secret_ keys only via apikey, legacy JWT keys via both headers', async () => {
    const seen: Array<Record<string, string>> = [];
    const fake: typeof fetch = async (_u, init) => {
      seen.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
      return new Response('[]', { status: 200 });
    };
    await new Db('https://x.supabase.co', 'sb_secret_abc', fake).select('profiles', 'select=id');
    await new Db('https://x.supabase.co', 'eyJhbGciOi.legacy.jwt', fake).select('profiles', 'select=id');
    expect(seen[0].Authorization).toBeUndefined();
    expect(seen[0].apikey).toBe('sb_secret_abc');
    expect(seen[1].Authorization).toBe('Bearer eyJhbGciOi.legacy.jwt');
  });
});
