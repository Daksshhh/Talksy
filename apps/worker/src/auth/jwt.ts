import { b64urlDecode, b64urlDecodeText } from './crypto';
import { unauthorized } from '../http';

/**
 * Supabase access-token verification.
 *
 * 1. Asymmetric keys (ES256 / RS256 / EdDSA) — verified locally against the project's
 *    public JWKS at {SUPABASE_URL}/auth/v1/.well-known/jwks.json (cached).
 * 2. Legacy HS256 — verified locally with SUPABASE_JWT_SECRET when configured.
 * 3. Otherwise (HS256 without secret) — verified remotely via GET /auth/v1/user.
 *
 * Always checks exp, iss and the "authenticated" role/audience.
 */
export interface AuthUser {
  id: string;
  isAnonymous: boolean;
  role: string;
  sessionId?: string;
  exp: number;
}

interface JwtHeader {
  alg: string;
  kid?: string;
  typ?: string;
}

interface JwtClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  role?: string;
  is_anonymous?: boolean;
  session_id?: string;
}

interface JwksCache {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}
const jwksCache = new Map<string, JwksCache>();
const JWKS_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_S = 30;

export interface VerifyConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  jwtSecret?: string;
  fetchImpl?: typeof fetch;
  nowS?: () => number;
}

function algParams(alg: string, jwk?: JsonWebKey): { import: AlgorithmIdentifier | RsaHashedImportParams | EcKeyImportParams; verify: AlgorithmIdentifier | EcdsaParams } | null {
  switch (alg) {
    case 'ES256':
      return { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } };
    case 'RS256':
      return { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } };
    case 'EdDSA':
      if (jwk && jwk.crv !== 'Ed25519') return null;
      return { import: { name: 'Ed25519' }, verify: { name: 'Ed25519' } };
    default:
      return null;
  }
}

async function getJwk(cfg: VerifyConfig, kid: string | undefined, alg: string): Promise<CryptoKey | null> {
  const url = `${cfg.supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  const now = Date.now();
  let cache = jwksCache.get(url);
  const lookup = () => {
    if (!cache) return null;
    if (kid) return cache.keys.get(kid) ?? null;
    return cache.keys.size === 1 ? [...cache.keys.values()][0] : null;
  };
  if (cache && now - cache.fetchedAt < JWKS_TTL_MS) {
    const k = lookup();
    if (k) return k;
    // Unknown kid: allow a refetch at most once per 30s (key rotation).
    if (now - cache.fetchedAt < 30_000) return null;
  }
  const res = await (cfg.fetchImpl ?? fetch)(url, { headers: { apikey: cfg.serviceRoleKey } });
  if (!res.ok) return null;
  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    const p = algParams(jwk.alg ?? alg, jwk);
    if (!p || !jwk.kid) continue;
    try {
      keys.set(jwk.kid, await crypto.subtle.importKey('jwk', jwk, p.import, false, ['verify']));
    } catch {
      /* ignore unsupported keys */
    }
  }
  cache = { keys, fetchedAt: now };
  jwksCache.set(url, cache);
  return lookup();
}

async function verifySignature(cfg: VerifyConfig, header: JwtHeader, signingInput: string, sig: Uint8Array): Promise<boolean | 'remote'> {
  const data = new TextEncoder().encode(signingInput);
  if (header.alg === 'HS256') {
    if (!cfg.jwtSecret) return 'remote';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(cfg.jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return crypto.subtle.verify('HMAC', key, sig as BufferSource, data);
  }
  const p = algParams(header.alg);
  if (!p) return false;
  const key = await getJwk(cfg, header.kid, header.alg);
  if (!key) return false;
  return crypto.subtle.verify(p.verify, key, sig as BufferSource, data);
}

async function verifyRemote(cfg: VerifyConfig, token: string): Promise<boolean> {
  const res = await (cfg.fetchImpl ?? fetch)(`${cfg.supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

export async function verifySupabaseJwt(token: string, cfg: VerifyConfig): Promise<AuthUser> {
  if (!token || token.length > 8192) throw unauthorized('Missing or invalid token');
  const parts = token.split('.');
  if (parts.length !== 3) throw unauthorized('Malformed token');
  let header: JwtHeader;
  let claims: JwtClaims;
  try {
    header = JSON.parse(b64urlDecodeText(parts[0]));
    claims = JSON.parse(b64urlDecodeText(parts[1]));
  } catch {
    throw unauthorized('Malformed token');
  }
  if (!header.alg || header.alg === 'none') throw unauthorized('Unsupported token');

  const nowS = cfg.nowS ? cfg.nowS() : Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) throw unauthorized('Session expired');
  if (typeof claims.sub !== 'string' || !claims.sub) throw unauthorized('Invalid token subject');
  const expectedIss = `${cfg.supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  if (claims.iss && claims.iss !== expectedIss) throw unauthorized('Invalid token issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.role !== 'authenticated' || !aud.includes('authenticated')) throw unauthorized('Invalid token audience');

  let valid: boolean | 'remote';
  try {
    valid = await verifySignature(cfg, header, `${parts[0]}.${parts[1]}`, b64urlDecode(parts[2]));
  } catch {
    valid = false;
  }
  if (valid === 'remote') valid = await verifyRemote(cfg, token);
  if (!valid) throw unauthorized('Invalid session');

  return {
    id: claims.sub,
    isAnonymous: claims.is_anonymous === true,
    role: claims.role,
    sessionId: claims.session_id,
    exp: claims.exp,
  };
}

export function bearerToken(req: Request): string | null {
  const h = req.headers.get('Authorization');
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

/** Test helper: clear JWKS cache. */
export function _clearJwksCache(): void {
  jwksCache.clear();
}
