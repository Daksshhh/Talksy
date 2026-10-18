import type { Env } from './env';

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  exec: ExecutionContext;
}
export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

/** Tiny path router: "/api/friends/:userId" style patterns. */
export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\//g, '\\/').replace(/:([A-Za-z]+)/g, (_, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '\\/?$',
    );
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | 'method_not_allowed' | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { handler: r.handler, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }
}
