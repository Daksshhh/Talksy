import { describe, it, expect, beforeEach } from 'vitest';
import { signRoomToken, verifyRoomToken } from '../auth/roomToken';
import { verifySupabaseJwt, _clearJwksCache } from '../auth/jwt';
import { b64urlEncode, hmacSign } from '../auth/crypto';
import { HttpError } from '../http';

const SECRET = 'unit-test-room-secret-unit-test-room-secret';
const ROOM = '7d6f9f0e-1b2c-4d3e-8f90-123456789abc';

describe('room tokens', () => {
  it('round-trips and binds room + user', async () => {
    const t = await signRoomToken(SECRET, ROOM, 'user-1', 60_000, 1000);
    const p = await verifyRoomToken(SECRET, t, ROOM, 2000);
    expect(p).toMatchObject({ r: ROOM, u: 'user-1' });
    expect(p!.n.length).toBeGreaterThan(8);
  });
  it('rejects expired tokens', async () => {
    const t = await signRoomToken(SECRET, ROOM, 'user-1', 60_000, 1000);
    expect(await verifyRoomToken(SECRET, t, ROOM, 1000 + 60_001)).toBeNull();
  });
  it('rejects tokens for another room', async () => {
    const t = await signRoomToken(SECRET, ROOM, 'user-1', 60_000);
    expect(await verifyRoomToken(SECRET, t, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
  it('rejects tampered payloads (forged user id) and wrong secrets', async () => {
    const t = await signRoomToken(SECRET, ROOM, 'user-1', 60_000);
    const [, sig] = t.split('.');
    const forgedBody = b64urlEncode(new TextEncoder().encode(JSON.stringify({ r: ROOM, u: 'user-2', n: 'x', e: Date.now() + 9e6 })));
    expect(await verifyRoomToken(SECRET, `${forgedBody}.${sig}`, ROOM)).toBeNull();
    expect(await verifyRoomToken('another-secret-another-secret', t, ROOM)).toBeNull();
    expect(await verifyRoomToken(SECRET, 'garbage', ROOM)).toBeNull();
  });
});

// ------------------------------------------------------------------ JWT
const SUPA = 'https://abc.supabase.co';
const enc = (o: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));
const nowS = () => Math.floor(Date.now() / 1000);
const baseClaims = () => ({ sub: '11111111-2222-4333-8444-555555555555', role: 'authenticated', aud: 'authenticated', iss: `${SUPA}/auth/v1`, exp: nowS() + 3600, is_anonymous: true });

let keyPair: CryptoKeyPair;
let jwk: JsonWebKey;
async function es256(claims: object, kid = 'k1') {
  const header = enc({ alg: 'ES256', kid, typ: 'JWT' });
  const body = enc(claims);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64urlEncode(sig)}`;
}
const fetchJwks: typeof fetch = async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', alg: 'ES256' }] }), { status: 200 });
const cfg = (extra = {}) => ({ supabaseUrl: SUPA, serviceRoleKey: 'svc', fetchImpl: fetchJwks, ...extra });

async function expectUnauthorized(p: Promise<unknown>) {
  await expect(p).rejects.toBeInstanceOf(HttpError);
  await p.catch((e: HttpError) => expect(e.status).toBe(401));
}

describe('Supabase JWT verification', () => {
  beforeEach(async () => {
    _clearJwksCache();
    keyPair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    jwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  });

  it('accepts a valid ES256 token via JWKS', async () => {
    const u = await verifySupabaseJwt(await es256(baseClaims()), cfg());
    expect(u).toMatchObject({ id: baseClaims().sub, isAnonymous: true });
  });
  it('rejects expired tokens', async () => {
    await expectUnauthorized(verifySupabaseJwt(await es256({ ...baseClaims(), exp: nowS() - 120 }), cfg()));
  });
  it('rejects wrong audience / role (e.g. anon key or service role tokens)', async () => {
    await expectUnauthorized(verifySupabaseJwt(await es256({ ...baseClaims(), role: 'anon', aud: 'anon' }), cfg()));
    await expectUnauthorized(verifySupabaseJwt(await es256({ ...baseClaims(), role: 'service_role' }), cfg()));
  });
  it('normalizes whitespace, quotes and trailing slashes in the configured Supabase URL', async () => {
    const u = await verifySupabaseJwt(await es256(baseClaims()), cfg({ supabaseUrl: `  "${SUPA}/"  ` }));
    expect(u.id).toBe(baseClaims().sub);
  });
  it('rejects wrong issuer', async () => {
    await expectUnauthorized(verifySupabaseJwt(await es256({ ...baseClaims(), iss: 'https://evil.example/auth/v1' }), cfg()));
  });
  it('rejects tampered payloads (privilege/identity escalation)', async () => {
    const t = await es256(baseClaims());
    const [h, , s] = t.split('.');
    const forged = `${h}.${enc({ ...baseClaims(), sub: '99999999-2222-4333-8444-555555555555' })}.${s}`;
    await expectUnauthorized(verifySupabaseJwt(forged, cfg()));
  });
  it('rejects alg=none and unknown kids', async () => {
    const none = `${enc({ alg: 'none' })}.${enc(baseClaims())}.`;
    await expectUnauthorized(verifySupabaseJwt(none, cfg()));
    await expectUnauthorized(verifySupabaseJwt(await es256(baseClaims(), 'other-kid'), cfg()));
  });
  it('verifies legacy HS256 with the shared secret, falls back to remote check without it', async () => {
    const secret = 'legacy-jwt-secret-legacy-jwt-secret';
    const h = enc({ alg: 'HS256', typ: 'JWT' });
    const b = enc(baseClaims());
    const good = `${h}.${b}.${await hmacSign(secret, `${h}.${b}`)}`;
    expect((await verifySupabaseJwt(good, cfg({ jwtSecret: secret }))).id).toBe(baseClaims().sub);
    await expectUnauthorized(verifySupabaseJwt(good, cfg({ jwtSecret: 'wrong-secret-wrong-secret-wrong' })));
    let remoteCalled = false;
    const remote: typeof fetch = async (url) => {
      remoteCalled = String(url).endsWith('/auth/v1/user');
      return new Response('{}', { status: 401 });
    };
    await expectUnauthorized(verifySupabaseJwt(good, { supabaseUrl: SUPA, serviceRoleKey: 'svc', fetchImpl: remote }));
    expect(remoteCalled).toBe(true);
  });
});
