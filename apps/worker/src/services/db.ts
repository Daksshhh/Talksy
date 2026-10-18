import { HttpError } from '../http';
import { log } from './logger';

/**
 * Minimal Supabase PostgREST + Auth Admin client using the service-role key.
 * Only used server-side (Worker / Durable Objects). All privileged mutations go
 * through SECURITY DEFINER SQL functions that take the *verified* actor id, so
 * business rules live in one place (the database) and are enforced atomically.
 */
export class Db {
  private readonly base: string;
  constructor(
    url: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {
    this.base = url.replace(/\/$/, '');
  }

  /**
   * New-style secret keys (sb_secret_...) must ONLY be sent in the `apikey` header —
   * Supabase rejects non-JWT values in `Authorization: Bearer`. Legacy service_role
   * keys are JWTs and are sent in both headers.
   */
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { apikey: this.serviceKey, 'Content-Type': 'application/json', ...extra };
    if (!this.serviceKey.startsWith('sb_')) h.Authorization = `Bearer ${this.serviceKey}`;
    return h;
  }

  private async handle<T>(res: Response, ctx: string): Promise<T> {
    if (res.ok) {
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    let body: { message?: string; code?: string; hint?: string; details?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw mapDbError(res.status, body, ctx);
  }

  async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(args),
    });
    return this.handle<T>(res, `rpc:${fn}`);
  }

  /** query example: "select=id,name&user_id=eq.<uuid>&order=created_at.desc&limit=20" */
  async select<T>(table: string, query: string): Promise<T[]> {
    const res = await this.fetchImpl(`${this.base}/rest/v1/${table}?${query}`, { headers: this.headers() });
    return this.handle<T[]>(res, `select:${table}`);
  }

  async selectOne<T>(table: string, query: string): Promise<T | null> {
    const rows = await this.select<T>(table, `${query}&limit=1`);
    return rows[0] ?? null;
  }

  async count(table: string, query: string): Promise<number> {
    const res = await this.fetchImpl(`${this.base}/rest/v1/${table}?select=*&${query}`, {
      method: 'HEAD',
      headers: this.headers({ Prefer: 'count=exact', Range: '0-0' }),
    });
    if (!res.ok && res.status !== 206) throw mapDbError(res.status, {}, `count:${table}`);
    const range = res.headers.get('Content-Range') ?? '*/0';
    return Number(range.split('/')[1] ?? 0) || 0;
  }

  async insert<T>(table: string, rows: unknown, opts: { returning?: boolean; upsert?: string } = {}): Promise<T[]> {
    const prefer = [opts.returning === false ? 'return=minimal' : 'return=representation'];
    let url = `${this.base}/rest/v1/${table}`;
    if (opts.upsert) {
      prefer.push('resolution=merge-duplicates');
      url += `?on_conflict=${opts.upsert}`;
    }
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.headers({ Prefer: prefer.join(',') }),
      body: JSON.stringify(rows),
    });
    return (await this.handle<T[]>(res, `insert:${table}`)) ?? [];
  }

  async update<T>(table: string, query: string, patch: Record<string, unknown>): Promise<T[]> {
    const res = await this.fetchImpl(`${this.base}/rest/v1/${table}?${query}`, {
      method: 'PATCH',
      headers: this.headers({ Prefer: 'return=representation' }),
      body: JSON.stringify(patch),
    });
    return (await this.handle<T[]>(res, `update:${table}`)) ?? [];
  }

  async delete(table: string, query: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: this.headers({ Prefer: 'return=minimal' }),
    });
    await this.handle<void>(res, `delete:${table}`);
  }

  async getAuthUser(userId: string): Promise<{ id: string; is_anonymous?: boolean; identities?: Array<{ provider: string }>; email?: string } | null> {
    const res = await this.fetchImpl(`${this.base}/auth/v1/admin/users/${userId}`, { headers: this.headers() });
    if (res.status === 404) return null;
    return this.handle(res, 'auth:get_user');
  }

  async deleteAuthUser(userId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    await this.handle<void>(res, 'auth:delete_user');
  }
}

/** Map PostgreSQL/PostgREST errors to typed API errors. Custom SQL errors use
 *  RAISE EXCEPTION '<code>:<message>' with SQLSTATE P0001. */
export function mapDbError(status: number, body: { message?: string; code?: string; hint?: string }, ctx: string): HttpError {
  const msg = body.message ?? '';
  const m = /^([a-z_]+):(.*)$/s.exec(msg);
  if (body.code === 'P0001' && m) {
    const code = m[1];
    const text = m[2].trim();
    switch (code) {
      case 'not_found':
        return new HttpError(404, 'not_found', text);
      case 'forbidden':
        return new HttpError(403, 'forbidden', text);
      case 'blocked':
        return new HttpError(403, 'blocked', text);
      case 'restricted':
        return new HttpError(403, 'restricted', text);
      case 'conflict':
        return new HttpError(409, 'conflict', text);
      case 'cooldown':
        return new HttpError(429, 'cooldown', text);
      case 'rate_limited':
        return new HttpError(429, 'rate_limited', text);
      default:
        return new HttpError(400, 'bad_request', text);
    }
  }
  if (body.code === '23505') return new HttpError(409, 'conflict', 'Already exists');
  if (body.code === '23503') return new HttpError(404, 'not_found', 'Related record not found');
  if (body.code === '23514' || body.code === '22P02') return new HttpError(400, 'bad_request', 'Invalid value');
  log('error', 'db_error', { ctx, status, code: body.code });
  return new HttpError(status >= 500 ? 502 : 500, 'server_error', 'Database request failed');
}
