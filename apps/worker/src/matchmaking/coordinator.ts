import { DurableObject } from 'cloudflare:workers';
import {
  LIMITS,
  RATE_LIMITS,
  parseLobbyClientEvent,
  type LobbyServerEvent,
  type PeerInfo,
} from '@orbit/shared';
import type { Env } from '../env';
import { MatchEngine, type JoinResult, type MatchProfile, type UserEntry } from './engine';
import { SlidingWindowLimiter } from '../lib/rateLimiter';
import { randomToken } from '../auth/crypto';
import { signRoomToken } from '../auth/roomToken';
import { log, shortId } from '../services/logger';

/**
 * MatchCoordinator — singleton Durable Object ("global").
 * Owns: lobby WebSockets (hibernatable), presence, the global waiting queue,
 * single-use realtime tickets, and per-user session state.
 *
 * Scaling note: one DO handles a few thousand concurrent lobby sockets comfortably.
 * See docs/architecture.md for the sharding strategy beyond that.
 */
interface TicketRecord {
  userId: string;
  profile: MatchProfile;
  blocked: string[];
  exp: number;
}

interface SocketAttachment {
  userId: string;
  connectedAt: number;
}

interface Metrics {
  joins: number;
  matches: number;
  totalWaitMs: number;
  disconnects: number;
  wsErrors: number;
  since: number;
}

const SWEEP_INTERVAL_MS = 15_000;
const IDLE_FORGET_MS = 30 * 60_000;

export class MatchCoordinator extends DurableObject<Env> {
  private engine: MatchEngine;
  private ticketLimiter = new SlidingWindowLimiter(RATE_LIMITS.ticket.limit, RATE_LIMITS.ticket.windowMs);
  private joinLimiter = new SlidingWindowLimiter(RATE_LIMITS.queueJoin.limit, RATE_LIMITS.queueJoin.windowMs);
  private nextLimiter = new SlidingWindowLimiter(RATE_LIMITS.next.limit, RATE_LIMITS.next.windowMs);
  private lastNextAt = new Map<string, number>();
  private metrics: Metrics = { joins: 0, matches: 0, totalWaitMs: 0, disconnects: 0, wsErrors: 0, since: Date.now() };
  private lastBroadcast = '';

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.engine = new MatchEngine({
      now: () => Date.now(),
      newRoomId: () => crypto.randomUUID(),
      staleMs: LIMITS.STALE_CONNECTION_MS,
      orphanMatchMs: LIMITS.RECONNECT_GRACE_MS * 6,
    });
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list<UserEntry>({ prefix: 'u:' });
      const seq = (await ctx.storage.get<number>('seq')) ?? 0;
      this.engine.restore([...stored.values()], seq);
      const m = await ctx.storage.get<Metrics>('metrics');
      if (m) this.metrics = m;
      // Reconcile with sockets that survived hibernation.
      const live = new Map<string, number>();
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as SocketAttachment | null;
        if (a?.userId) live.set(a.userId, (live.get(a.userId) ?? 0) + 1);
      }
      this.engine.syncConnections(live);
      await this.flush();
    });
  }

  // ---------------------------------------------------------------- persistence
  private async flush(): Promise<void> {
    const ids = this.engine.takeDirty();
    if (!ids.length) return;
    const puts: Record<string, unknown> = { seq: this.engine.queueSeqCounter };
    const dels: string[] = [];
    for (const id of ids) {
      const e = this.engine.get(id);
      if (e) puts[`u:${id}`] = e;
      else dels.push(`u:${id}`);
    }
    await this.ctx.storage.put(puts);
    if (dels.length) await this.ctx.storage.delete(dels);
  }

  private async ensureAlarm(): Promise<void> {
    const cur = await this.ctx.storage.getAlarm();
    if (!cur) await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
  }

  // ---------------------------------------------------------------- socket helpers
  private socketsOf(userId: string): WebSocket[] {
    return this.ctx.getWebSockets(userId);
  }

  private send(ws: WebSocket, ev: LobbyServerEvent): void {
    try {
      ws.send(JSON.stringify(ev));
    } catch {
      /* socket already closed */
    }
  }

  private sendUser(userId: string, ev: LobbyServerEvent): void {
    for (const ws of this.socketsOf(userId)) this.send(ws, ev);
  }

  private peerInfo(e: UserEntry | undefined): PeerInfo {
    return {
      displayName: e?.profile.displayName ?? 'Stranger',
      avatarSeed: e?.profile.avatarSeed ?? 'orbit',
      avatarStyle: e?.profile.avatarStyle ?? 'orbit',
    };
  }

  private roomStub(roomId: string) {
    return this.env.CHAT_ROOM.get(this.env.CHAT_ROOM.idFromName(roomId));
  }

  private tellRoomToEnd(roomId: string, reason: string, by: string | null): void {
    const p = this.roomStub(roomId)
      .fetch('https://room/internal/end', { method: 'POST', body: JSON.stringify({ reason, by }) })
      .then((r) => r.body?.cancel())
      .catch((err) => log('error', 'room_end_notify_failed', { room: shortId(roomId), err: String(err) }));
    this.ctx.waitUntil(p);
  }

  // ---------------------------------------------------------------- HTTP entry
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      switch (url.pathname) {
        case '/ws':
          return await this.acceptLobby(req, url);
        case '/internal/ticket':
          return await this.issueTicket(req);
        case '/internal/room-ended': {
          const { roomId } = (await req.json()) as { roomId: string };
          this.engine.endRoom(roomId);
          await this.flush();
          return Response.json({ ok: true });
        }
        case '/internal/block': {
          const { a, b } = (await req.json()) as { a: string; b: string };
          const roomId = this.engine.block(a, b);
          await this.flush();
          if (roomId) this.tellRoomToEnd(roomId, 'blocked', a);
          return Response.json({ ok: true, endedRoom: !!roomId });
        }
        case '/internal/evict': {
          const { userId, reason } = (await req.json()) as { userId: string; reason: string };
          const roomId = this.engine.evict(userId);
          await this.flush();
          if (roomId) this.tellRoomToEnd(roomId, 'moderation', null);
          for (const ws of this.socketsOf(userId)) {
            this.send(ws, { type: 'error', code: 'restricted', message: reason || 'Your session was closed.' });
            ws.close(4003, 'restricted');
          }
          return Response.json({ ok: true });
        }
        case '/internal/presence': {
          const { ids } = (await req.json()) as { ids: string[] };
          const out: Record<string, string> = {};
          for (const id of (ids ?? []).slice(0, 500)) out[id] = this.engine.presenceOf(id);
          return Response.json(out);
        }
        case '/internal/stats': {
          const s = this.engine.stats();
          return Response.json({
            ...s,
            metrics: {
              joins: this.metrics.joins,
              matches: this.metrics.matches,
              avgWaitMs: this.metrics.matches ? Math.round(this.metrics.totalWaitMs / this.metrics.matches) : null,
              disconnects: this.metrics.disconnects,
              wsErrors: this.metrics.wsErrors,
              since: this.metrics.since,
            },
          });
        }
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (err) {
      log('error', 'coordinator_fetch_error', { path: url.pathname, err: String(err) });
      return Response.json({ error: 'internal' }, { status: 500 });
    }
  }

  private async issueTicket(req: Request): Promise<Response> {
    const body = (await req.json()) as { userId: string; profile: MatchProfile; blocked: string[] };
    const wait = this.ticketLimiter.take(body.userId);
    if (wait) return Response.json({ error: 'rate_limited', retryAfterMs: wait }, { status: 429 });
    const ticket = randomToken(32);
    const exp = Date.now() + LIMITS.TICKET_TTL_MS;
    const rec: TicketRecord = { userId: body.userId, profile: body.profile, blocked: body.blocked ?? [], exp };
    await this.ctx.storage.put(`t:${ticket}`, rec);
    await this.ensureAlarm();
    return Response.json({ ticket, expiresAt: exp });
  }

  private async acceptLobby(req: Request, url: URL): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const ticket = url.searchParams.get('ticket') ?? '';
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(ticket)) return new Response('Invalid ticket', { status: 401 });
    const key = `t:${ticket}`;
    // get + delete inside one DO turn => single use, even under concurrent reuse attempts.
    const rec = await this.ctx.storage.get<TicketRecord>(key);
    await this.ctx.storage.delete(key);
    if (!rec || rec.exp < Date.now()) {
      log('warn', 'ticket_rejected', { reason: rec ? 'expired' : 'unknown_or_reused' });
      return new Response('Invalid or expired ticket', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [rec.userId]);
    server.serializeAttachment({ userId: rec.userId, connectedAt: Date.now() } satisfies SocketAttachment);

    const entry = this.engine.connect(rec.userId, rec.profile, rec.blocked);
    await this.flush();
    await this.ensureAlarm();
    const s = this.engine.stats();
    this.send(server, {
      type: 'hello',
      state: entry.state === 'QUEUED' ? 'QUEUED' : entry.state === 'MATCHED' ? 'MATCHED' : 'IDLE',
      activeSessionId: entry.roomId ?? undefined,
      online: s.online,
      waiting: s.waiting,
    });
    if (entry.state === 'QUEUED') {
      this.send(server, { type: 'queue:waiting', since: entry.queuedAt ?? Date.now(), position: this.engine.positionOf(rec.userId), waiting: s.waiting });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------- WebSocket events
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att?.userId) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const userId = att.userId;
    const parsed = parseLobbyClientEvent(message);
    if (!parsed.ok) {
      this.send(ws, { type: 'error', code: 'invalid_event', message: parsed.error });
      return;
    }
    this.engine.heartbeat(userId);
    const ev = parsed.value;
    switch (ev.type) {
      case 'ping':
        this.send(ws, { type: 'pong', ts: Date.now() });
        return;
      case 'queue:join': {
        const wait = this.joinLimiter.take(userId);
        if (wait) {
          this.send(ws, { type: 'queue:error', code: 'rate_limited', message: 'You are searching too often. Take a short break.', retryAfterMs: wait });
          return;
        }
        this.metrics.joins++;
        await this.handleJoinResult(userId, this.engine.join(userId));
        return;
      }
      case 'queue:next': {
        const now = Date.now();
        const last = this.lastNextAt.get(userId) ?? 0;
        const wait = now - last < RATE_LIMITS.nextMinGapMs ? RATE_LIMITS.nextMinGapMs - (now - last) : this.nextLimiter.take(userId);
        if (wait) {
          this.send(ws, { type: 'queue:error', code: 'rate_limited', message: 'Slow down — skipping too fast.', retryAfterMs: wait });
          return;
        }
        this.lastNextAt.set(userId, now);
        this.metrics.joins++;
        const r = this.engine.next(userId);
        if (r.endedRoomId) this.tellRoomToEnd(r.endedRoomId, 'next', userId);
        await this.handleJoinResult(userId, r.result);
        return;
      }
      case 'queue:leave': {
        this.engine.leave(userId);
        await this.flush();
        this.sendUser(userId, { type: 'queue:left' });
        return;
      }
      case 'session:end': {
        const e = this.engine.get(userId);
        if (e?.roomId) {
          const roomId = e.roomId;
          this.engine.endRoom(roomId);
          this.tellRoomToEnd(roomId, 'left', userId);
        } else {
          this.engine.leave(userId);
        }
        await this.flush();
        this.sendUser(userId, { type: 'session:none' });
        return;
      }
      case 'session:resume': {
        const e = this.engine.get(userId);
        if (!e?.roomId) {
          this.send(ws, { type: 'session:none' });
          return;
        }
        const token = await signRoomToken(this.env.ROOM_TOKEN_SECRET, e.roomId, userId, LIMITS.ROOM_TOKEN_TTL_MS);
        this.send(ws, { type: 'queue:matched', sessionId: e.roomId, roomToken: token, peer: this.peerInfo(this.engine.get(e.peerId ?? '')), resumed: true });
        return;
      }
    }
  }

  private async handleJoinResult(userId: string, res: JoinResult): Promise<void> {
    if (res.type === 'error') {
      await this.flush();
      if (res.code === 'already_in_session') {
        this.sendUser(userId, { type: 'queue:error', code: 'already_in_session', message: 'You are already in a chat.', sessionId: res.roomId });
      } else {
        this.sendUser(userId, { type: 'queue:error', code: 'server_error', message: 'Please reconnect and try again.' });
      }
      return;
    }
    if (res.type === 'queued') {
      await this.flush();
      const s = this.engine.stats();
      this.sendUser(userId, { type: 'queue:waiting', since: this.engine.get(userId)?.queuedAt ?? Date.now(), position: res.position, waiting: s.waiting });
      return;
    }
    // Matched: decision already committed in memory; persist, then create the room.
    await this.flush();
    const { roomId, userA, userB, waitedMs } = res;
    this.metrics.matches++;
    this.metrics.totalWaitMs += waitedMs;
    try {
      const r = await this.roomStub(roomId).fetch('https://room/internal/init', {
        method: 'POST',
        body: JSON.stringify({
          roomId,
          a: { userId: userA.userId, profile: this.peerInfo(userA) },
          b: { userId: userB.userId, profile: this.peerInfo(userB) },
        }),
      });
      if (!r.ok) throw new Error(`room init ${r.status}`);
    } catch (err) {
      log('error', 'room_init_failed', { room: shortId(roomId), err: String(err) });
      this.engine.endRoom(roomId);
      await this.flush();
      for (const u of [userA.userId, userB.userId]) {
        this.sendUser(u, { type: 'queue:error', code: 'server_error', message: 'Could not start the chat. Please try again.' });
      }
      return;
    }
    // Another event may have run during the await (e.g. Next/End). Verify still valid.
    const a = this.engine.get(userA.userId);
    const b = this.engine.get(userB.userId);
    if (a?.roomId !== roomId || b?.roomId !== roomId) {
      this.tellRoomToEnd(roomId, 'left', null);
      return;
    }
    for (const [me, peer] of [
      [a, b],
      [b, a],
    ] as const) {
      const token = await signRoomToken(this.env.ROOM_TOKEN_SECRET, roomId, me.userId, LIMITS.ROOM_TOKEN_TTL_MS);
      this.sendUser(me.userId, { type: 'queue:matched', sessionId: roomId, roomToken: token, peer: this.peerInfo(peer), resumed: false });
    }
    log('info', 'match', { room: shortId(roomId), waitedMs });
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onSocketGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.metrics.wsErrors++;
    await this.onSocketGone(ws);
  }

  private async onSocketGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    if (!att?.userId) return;
    this.metrics.disconnects++;
    this.engine.disconnect(att.userId);
    await this.flush();
    try {
      ws.close(1000, 'bye');
    } catch {
      /* already closed */
    }
  }

  // ---------------------------------------------------------------- periodic sweep
  override async alarm(): Promise<void> {
    const now = Date.now();
    // Drop expired tickets.
    const tickets = await this.ctx.storage.list<TicketRecord>({ prefix: 't:' });
    const expired = [...tickets].filter(([, t]) => t.exp < now).map(([k]) => k);
    if (expired.length) await this.ctx.storage.delete(expired);

    // Recount live sockets (handles sockets that vanished without a close frame).
    const live = new Map<string, number>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as SocketAttachment | null;
      if (a?.userId) live.set(a.userId, (live.get(a.userId) ?? 0) + 1);
    }
    this.engine.syncConnections(live);
    const { removedFromQueue } = this.engine.sweep(IDLE_FORGET_MS);
    for (const id of removedFromQueue) this.sendUser(id, { type: 'queue:left' });
    await this.flush();
    await this.ctx.storage.put('metrics', this.metrics);

    // Broadcast approximate presence counts (only when changed).
    const s = this.engine.stats();
    const payload = JSON.stringify({ type: 'presence:count', online: s.online, waiting: s.waiting, inChat: s.inChat } satisfies LobbyServerEvent);
    if (payload !== this.lastBroadcast) {
      this.lastBroadcast = payload;
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(payload);
        } catch {
          /* ignore */
        }
      }
    }
    // Keep sweeping while anyone is around; otherwise go idle.
    if (this.ctx.getWebSockets().length || tickets.size - expired.length > 0 || this.engine.users.size) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
