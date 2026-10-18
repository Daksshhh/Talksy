import { DurableObject } from 'cloudflare:workers';
import { LIMITS, parseRoomClientEvent, type PeerInfo, type RoomServerEvent } from '@orbit/shared';
import { getQuestion, pickQuestion } from '@orbit/quest-content';
import type { Env } from '../env';
import { RoomEngine, type RoomEffect, type RoomMessage, type RoomMeta } from './engine';
import { Db } from '../services/db';
import { log, shortId } from '../services/logger';

/**
 * ChatRoom — one Durable Object per random-chat session.
 * Hibernatable WebSockets tagged with the participant's userId.
 * Persists room meta + message buffer in DO storage so hibernation/eviction
 * and browser refreshes within the grace period can restore the chat.
 * Buffer is deleted when the room ends (privacy).
 */
interface Attachment {
  userId: string;
}

export class ChatRoom extends DurableObject<Env> {
  private engine: RoomEngine | null = null;
  private persistedSeqs = new Set<number>();
  private lastMetaJson = '';
  private db: Db;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.db = new Db(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    ctx.blockConcurrencyWhile(async () => {
      const meta = await ctx.storage.get<RoomMeta>('meta');
      if (!meta) return;
      const msgs = await ctx.storage.list<RoomMessage>({ prefix: 'm:' });
      const messages = [...msgs.values()].sort((a, b) => a.seq - b.seq);
      messages.forEach((m) => this.persistedSeqs.add(m.seq));
      this.engine = new RoomEngine(meta, messages, this.engineOpts());
      this.lastMetaJson = JSON.stringify(meta);
    });
  }

  private engineOpts() {
    return {
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
      graceMs: LIMITS.RECONNECT_GRACE_MS,
      pickQuestion: (c: Parameters<typeof pickQuestion>[0], used: string[]) => pickQuestion(c, used),
      getQuestion: (id: string) => getQuestion(id),
    };
  }

  // ---------------------------------------------------------------- persistence
  private async persist(): Promise<void> {
    const e = this.engine;
    if (!e) return;
    const metaJson = JSON.stringify(e.meta);
    const puts: Record<string, unknown> = {};
    if (metaJson !== this.lastMetaJson) {
      puts.meta = e.meta;
      this.lastMetaJson = metaJson;
    }
    const live = new Set<number>();
    for (const m of e.messages) {
      live.add(m.seq);
      if (!this.persistedSeqs.has(m.seq)) {
        puts[`m:${String(m.seq).padStart(8, '0')}`] = m;
        this.persistedSeqs.add(m.seq);
      }
    }
    const dels: string[] = [];
    for (const seq of [...this.persistedSeqs]) {
      if (!live.has(seq)) {
        dels.push(`m:${String(seq).padStart(8, '0')}`);
        this.persistedSeqs.delete(seq);
      }
    }
    if (Object.keys(puts).length) await this.ctx.storage.put(puts);
    if (dels.length) await this.ctx.storage.delete(dels);
  }

  private async scheduleAlarm(): Promise<void> {
    const e = this.engine;
    if (!e) return;
    const due = e.ended ? (e.meta.endedAt ?? Date.now()) + LIMITS.ENDED_ROOM_TOMBSTONE_MS : e.nextDeadline();
    if (due) await this.ctx.storage.setAlarm(due);
    else await this.ctx.storage.deleteAlarm();
  }

  // ---------------------------------------------------------------- effects
  private bg(p: Promise<unknown>, what: string): void {
    this.ctx.waitUntil(p.catch((err) => log('error', 'room_side_effect_failed', { what, room: shortId(this.engine?.meta.roomId), err: String(err) })));
  }

  private sendTo(userId: string, ev: RoomServerEvent): void {
    const data = JSON.stringify(ev);
    for (const ws of this.ctx.getWebSockets(userId)) {
      try {
        ws.send(data);
      } catch {
        /* closed */
      }
    }
  }

  private async apply(effects: RoomEffect[]): Promise<void> {
    const e = this.engine!;
    const roomId = e.meta.roomId;
    // 1) Deliver socket events first (lowest latency).
    for (const fx of effects) if (fx.kind === 'send') this.sendTo(fx.to, fx.event);
    for (const fx of effects) {
      switch (fx.kind) {
        case 'close':
          for (const ws of this.ctx.getWebSockets(fx.userId)) {
            try {
              ws.close(1000, 'ended');
            } catch {
              /* ignore */
            }
          }
          break;
        case 'activated':
          this.bg(this.db.rpc('set_random_session_status', { p_session: roomId, p_status: 'ACTIVE' }), 'session_active');
          break;
        case 'ended': {
          this.bg(this.db.rpc('set_random_session_status', { p_session: roomId, p_status: 'ENDED', p_reason: fx.reason }), 'session_end');
          const coord = this.env.MATCH_COORDINATOR.get(this.env.MATCH_COORDINATOR.idFromName('global'));
          this.bg(
            coord.fetch('https://coord/internal/room-ended', { method: 'POST', body: JSON.stringify({ roomId }) }).then((r) => r.body?.cancel()),
            'coordinator_notify',
          );
          log('info', 'room_ended', { room: shortId(roomId), reason: fx.reason });
          break;
        }
        case 'report': {
          this.bg(
            this.db.rpc('create_report', {
              p_actor: fx.reporterId,
              p_reason: fx.reason,
              p_details: fx.details,
              p_context: 'random_chat',
              p_session: roomId,
              p_evidence: { messages: fx.evidence, capturedAt: Date.now() },
            }),
            'report',
          );
          if (fx.alsoBlock) {
            this.bg(this.db.rpc('block_user', { p_actor: fx.reporterId, p_target: fx.reportedId }), 'block');
            const coord = this.env.MATCH_COORDINATOR.get(this.env.MATCH_COORDINATOR.idFromName('global'));
            this.bg(
              coord.fetch('https://coord/internal/block', { method: 'POST', body: JSON.stringify({ a: fx.reporterId, b: fx.reportedId }) }).then((r) => r.body?.cancel()),
              'coordinator_block',
            );
          }
          break;
        }
        case 'save_transcript':
          this.bg(
            this.db.rpc('save_random_transcript', {
              p_session: roomId,
              p_consented: fx.consentedBy,
              p_messages: fx.messages.filter((m) => m.senderId).map((m) => ({ seq: m.seq, senderId: m.senderId, text: m.text, ts: m.ts })),
            }),
            'save_transcript',
          );
          break;
        case 'safety_event':
          this.bg(this.db.insert('safety_events', { user_id: fx.userId, session_id: roomId, kind: fx.event, detail: fx.detail }, { returning: false }), 'safety_event');
          break;
        case 'quest_summary':
          this.bg(
            this.db.insert(
              'conversation_quest_sessions',
              { session_id: roomId, category: fx.category, rounds_completed: fx.rounds, started_at: new Date(fx.startedAt).toISOString() },
              { returning: false },
            ),
            'quest_summary',
          );
          break;
        default:
          break;
      }
    }
    await this.persist();
    await this.scheduleAlarm();
  }

  // ---------------------------------------------------------------- HTTP entry
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.pathname === '/internal/init') return await this.init(req);
      if (url.pathname === '/ws') return await this.acceptSocket(req);
      if (url.pathname === '/internal/end') {
        const { reason, by } = (await req.json()) as { reason: 'next' | 'left' | 'blocked' | 'moderation'; by: string | null };
        if (this.engine && !this.engine.ended) await this.apply(this.engine.end(reason, by));
        return Response.json({ ok: true });
      }
      if (url.pathname === '/internal/event') {
        const body = (await req.json()) as { type: 'friend_request'; from: string; status: 'pending' | 'accepted' };
        const e = this.engine;
        if (e && !e.ended && e.isParticipant(body.from)) {
          const to = e.peerOf(body.from).userId;
          this.sendTo(body.from, { type: 'chat:friend_request', direction: 'outgoing', status: body.status });
          this.sendTo(to, { type: 'chat:friend_request', direction: 'incoming', status: body.status });
        }
        return Response.json({ ok: true });
      }
      return new Response('Not found', { status: 404 });
    } catch (err) {
      log('error', 'room_fetch_error', { path: url.pathname, err: String(err) });
      return Response.json({ error: 'internal' }, { status: 500 });
    }
  }

  private async init(req: Request): Promise<Response> {
    const body = (await req.json()) as { roomId: string; a: { userId: string; profile: PeerInfo }; b: { userId: string; profile: PeerInfo } };
    if (this.engine) return Response.json({ ok: true, existing: true });
    this.engine = RoomEngine.create(body.roomId, body.a, body.b, this.engineOpts());
    await this.persist();
    await this.scheduleAlarm();
    // Record the session (metadata only) for history. Awaited so history/report FKs exist.
    try {
      await this.db.rpc('create_random_session', {
        p_session: body.roomId,
        p_user_a: body.a.userId,
        p_user_b: body.b.userId,
        p_name_a: body.a.profile.displayName,
        p_name_b: body.b.profile.displayName,
        p_seed_a: body.a.profile.avatarSeed,
        p_seed_b: body.b.profile.avatarSeed,
      });
    } catch (err) {
      log('error', 'session_record_failed', { room: shortId(body.roomId), err: String(err) });
    }
    return Response.json({ ok: true });
  }

  private async acceptSocket(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    // These headers are set by our Worker after verifying the signed room token.
    const userId = req.headers.get('X-Orbit-User') ?? '';
    const nonce = req.headers.get('X-Orbit-Nonce') ?? '';
    const e = this.engine;
    if (!e || !e.isParticipant(userId)) return new Response('Forbidden', { status: 403 });
    if (!e.consumeNonce(nonce)) return new Response('Token already used', { status: 401 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    // Replace older sockets of the same user (refresh / duplicate tab).
    for (const old of this.ctx.getWebSockets(userId)) {
      try {
        old.serializeAttachment({ userId: '' });
        old.close(4000, 'replaced');
      } catch {
        /* ignore */
      }
    }
    this.ctx.acceptWebSocket(server, [userId]);
    server.serializeAttachment({ userId } satisfies Attachment);
    await this.apply(e.connect(userId));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    const e = this.engine;
    if (!att?.userId || !e) {
      ws.close(4001, 'unauthorized');
      return;
    }
    const parsed = parseRoomClientEvent(message);
    if (!parsed.ok) {
      ws.send(JSON.stringify({ type: 'error', code: 'invalid_event', message: parsed.error } satisfies RoomServerEvent));
      return;
    }
    await this.apply(e.handle(att.userId, parsed.value));
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.onGone(ws);
  }

  private async onGone(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Attachment | null;
    const e = this.engine;
    if (!att?.userId || !e) return;
    // Still another live socket for this user (e.g. replaced)? Then nothing changes.
    const others = this.ctx.getWebSockets(att.userId).filter((s) => s !== ws && s.readyState === WebSocket.OPEN);
    if (others.length) return;
    await this.apply(e.disconnect(att.userId));
  }

  override async alarm(): Promise<void> {
    const e = this.engine;
    if (!e) return;
    if (e.ended) {
      const endedAt = e.meta.endedAt ?? 0;
      if (Date.now() >= endedAt + LIMITS.ENDED_ROOM_TOMBSTONE_MS) {
        await this.ctx.storage.deleteAll();
        this.engine = null;
        return;
      }
      await this.scheduleAlarm();
      return;
    }
    await this.apply(e.tick());
  }
}
