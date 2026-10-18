import { isUuid } from '@orbit/shared';
import type { Env } from './env';
import { Router, type Ctx } from './router';
import { corsHeaders, errorResponse, isAllowedOrigin, json } from './http';
import { verifyRoomToken } from './auth/roomToken';
import { coordinator, room } from './services/coordinator';
import { log } from './services/logger';
import { db } from './middleware/auth';
import * as me from './routes/me';
import * as social from './routes/social';
import * as adminRoutes from './routes/admin';

export { MatchCoordinator } from './matchmaking/coordinator';
export { ChatRoom } from './rooms/room';

const router = new Router()
  .get('/api/health', () => json({ ok: true, ts: Date.now() }))
  // profile
  .get('/api/me', me.getMe)
  .patch('/api/me', me.patchMe)
  .delete('/api/me', me.deleteMe)
  .get('/api/me/export', me.exportMe)
  .get('/api/profiles/:userId', me.getPublicProfile)
  // friends
  .get('/api/friends', social.listFriends)
  .delete('/api/friends/:userId', social.removeFriend)
  .get('/api/friend-requests', social.listFriendRequests)
  .post('/api/friend-requests', social.createFriendRequest)
  .post('/api/friend-requests/:id/accept', (c) => social.respondFriendRequest(c, true))
  .post('/api/friend-requests/:id/decline', (c) => social.respondFriendRequest(c, false))
  .delete('/api/friend-requests/:id', social.cancelFriendRequest)
  // history
  .get('/api/history', social.listHistory)
  .get('/api/history/:sessionId', social.getHistoryItem)
  .delete('/api/history/:sessionId', social.hideHistoryItem)
  .delete('/api/history/:sessionId/transcript', social.revokeTranscript)
  // safety
  .post('/api/reports', social.createReport)
  .get('/api/blocks', social.listBlocks)
  .post('/api/blocks', social.createBlock)
  .delete('/api/blocks/:userId', social.deleteBlock)
  // presence & realtime
  .get('/api/presence/count', social.presenceCount)
  .get('/api/presence/friends', social.friendsPresence)
  .post('/api/realtime-ticket', social.issueTicket)
  // admin
  .get('/api/admin/metrics', adminRoutes.metrics)
  .get('/api/admin/reports', adminRoutes.listReports)
  .get('/api/admin/reports/:id', adminRoutes.getReport)
  .post('/api/admin/reports/:id', adminRoutes.updateReport)
  .post('/api/admin/users/:userId/restrict', adminRoutes.restrictUser)
  .post('/api/admin/users/:userId/lift', adminRoutes.liftRestriction)
  .get('/api/admin/actions', adminRoutes.listActions)
  .get('/api/admin/safety-events', adminRoutes.listSafetyEvents);

async function handleWebSocket(req: Request, env: Env, url: URL): Promise<Response> {
  if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
  // Cross-origin protection: browsers always send Origin on WebSocket handshakes.
  if (!isAllowedOrigin(env, req.headers.get('Origin'))) return new Response('Forbidden origin', { status: 403 });

  if (url.pathname === '/ws/lobby') {
    const target = new URL('https://coord/ws');
    target.searchParams.set('ticket', url.searchParams.get('ticket') ?? '');
    return coordinator(env).fetch(new Request(target, { headers: { Upgrade: 'websocket' } }));
  }

  const m = /^\/ws\/room\/([^/]+)$/.exec(url.pathname);
  if (m && isUuid(m[1])) {
    const roomId = m[1];
    const payload = await verifyRoomToken(env.ROOM_TOKEN_SECRET, url.searchParams.get('token') ?? '', roomId);
    if (!payload) return new Response('Invalid or expired room token', { status: 401 });
    // Identity headers are constructed here — never forwarded from the client.
    return room(env, roomId).fetch(
      new Request('https://room/ws', { headers: { Upgrade: 'websocket', 'X-Orbit-User': payload.u, 'X-Orbit-Nonce': payload.n } }),
    );
  }
  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(env, origin);

    if (url.pathname.startsWith('/ws/')) {
      try {
        return await handleWebSocket(req, env, url);
      } catch (err) {
        log('error', 'ws_upgrade_failed', { err: String(err) });
        return new Response('WebSocket error', { status: 500 });
      }
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: origin && isAllowedOrigin(env, origin) ? 204 : 403, headers: cors });
    }
    // Reject browser requests from unknown origins (non-browser clients send no Origin).
    if (origin && !isAllowedOrigin(env, origin)) {
      return json({ error: { code: 'forbidden', message: 'Origin not allowed' } }, 403);
    }

    const match = router.match(req.method, url.pathname);
    let res: Response;
    if (match === null) res = json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    else if (match === 'method_not_allowed') res = json({ error: { code: 'bad_request', message: 'Method not allowed' } }, 405);
    else {
      const ctx: Ctx = { req, env, url, params: match.params, exec };
      const started = Date.now();
      try {
        res = await match.handler(ctx);
      } catch (err) {
        res = errorResponse(err);
        if (res.status >= 500) log('error', 'api_exception', { path: url.pathname, method: req.method, err: String(err) });
      }
      if (Date.now() - started > 1500) log('warn', 'slow_request', { path: url.pathname, ms: Date.now() - started });
    }
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },

  /** Cron: data-retention purge (see wrangler.toml [triggers]). */
  async scheduled(_event: ScheduledEvent, env: Env, exec: ExecutionContext): Promise<void> {
    exec.waitUntil(
      db(env)
        .rpc('purge_expired_data')
        .then((r) => log('info', 'retention_purge', { result: r }))
        .catch((err) => log('error', 'retention_purge_failed', { err: String(err) })),
    );
  },
} satisfies ExportedHandler<Env>;
