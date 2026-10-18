import type { ApiErrorBody, ApiErrorCode } from '@orbit/shared';
import { env } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode | 'network',
    message: string,
    public field?: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

async function token(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? null;
  }
  const { data } = await supabase.auth.getSession(); // refreshes if expired
  return data.session?.access_token ?? null;
}

interface Opts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Typed fetch wrapper for the Worker REST API with one transparent token refresh on 401. */
export async function api<T>(path: string, opts: Opts = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.auth !== false) {
    const t = await token(retried);
    if (!t) throw new ApiError(401, 'unauthorized', 'Please sign in again.');
    headers.Authorization = `Bearer ${t}`;
  }
  let res: Response;
  try {
    res = await fetch(`${env.apiBase}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', 'Network error — check your connection and try again.');
  }
  if (res.status === 401 && opts.auth !== false && !retried) return api<T>(path, opts, true);
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const e = (data as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, e?.code ?? 'server_error', e?.message ?? `Request failed (${res.status})`, e?.field, e?.retryAfterMs);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = String((err as { message: string }).message);
    // Supabase RPC errors use "<code>:<message>" — strip the code prefix for display.
    return m.replace(/^[a-z_]+:/, '').trim() || 'Something went wrong.';
  }
  return 'Something went wrong.';
}
