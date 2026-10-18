import { b64urlDecodeText, b64urlEncode, hmacSign, hmacVerify, randomToken } from './crypto';

/**
 * Room join tokens: HMAC-SHA256 signed, short-lived, bound to (room, user) and
 * carrying a nonce that the ChatRoom DO accepts only once.
 * Format: base64url(json payload) + "." + base64url(signature)
 */
export interface RoomTokenPayload {
  r: string; // room id
  u: string; // user id
  n: string; // nonce
  e: number; // expiry (ms epoch)
}

export async function signRoomToken(secret: string, roomId: string, userId: string, ttlMs: number, now = Date.now()): Promise<string> {
  const payload: RoomTokenPayload = { r: roomId, u: userId, n: randomToken(12), e: now + ttlMs };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmacSign(secret, body)}`;
}

export async function verifyRoomToken(
  secret: string,
  token: string,
  expectedRoomId: string,
  now = Date.now(),
): Promise<RoomTokenPayload | null> {
  if (typeof token !== 'string' || token.length > 512) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (!(await hmacVerify(secret, body, sig))) return null;
  let p: RoomTokenPayload;
  try {
    p = JSON.parse(b64urlDecodeText(body));
  } catch {
    return null;
  }
  if (p.r !== expectedRoomId || typeof p.u !== 'string' || typeof p.n !== 'string') return null;
  if (typeof p.e !== 'number' || p.e < now) return null;
  return p;
}
