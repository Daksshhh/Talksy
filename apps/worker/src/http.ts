import type { ApiErrorCode } from '@orbit/shared';
import type { Env } from './env';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly field?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, field?: string) => new HttpError(400, 'bad_request', msg, field);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Not found') => new HttpError(404, 'not_found', msg);

export function allowedOrigins(env: Env): string[] {
  return (env.CLIENT_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export function isAllowedOrigin(env: Env, origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}

export function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && isAllowedOrigin(env, origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, X-Turnstile-Token';
    h['Access-Control-Allow-Methods'] = 'GET, POST, PATCH, DELETE, OPTIONS';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra },
  });
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    if (err.retryAfterMs) headers['Retry-After'] = String(Math.ceil(err.retryAfterMs / 1000));
    return json({ error: { code: err.code, message: err.message, field: err.field, retryAfterMs: err.retryAfterMs } }, err.status, headers);
  }
  return json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } }, 500);
}

export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw badRequest('Request body too large');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('Invalid JSON');
  }
}
