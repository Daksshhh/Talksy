/**
 * Worker-compatible integration tests (workerd + Miniflare, real Durable Objects
 * and WebSockets). Run with: pnpm --filter @orbit/worker test:integration
 *
 * Tickets are minted directly on the coordinator DO (the REST ticket endpoint needs
 * Supabase); everything after that — origin checks, ticket consumption, matching,
 * room tokens, room sockets, messaging, Next — goes through the public Worker.
 */
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { LobbyServerEvent, RoomServerEvent } from '@orbit/shared';

const ORIGIN = 'http://localhost:5173';

async function ticketFor(userId: string, blocked: string[] = []): Promise<string> {
  const stub = env.MATCH_COORDINATOR.get(env.MATCH_COORDINATOR.idFromName('global'));
  const r = await stub.fetch('https://coord/internal/ticket', {
    method: 'POST',
    body: JSON.stringify({ userId, profile: { displayName: `N-${userId}`, avatarSeed: 'abcd1234', avatarStyle: 'orbit' }, blocked }),
  });
  return ((await r.json()) as { ticket: string }).ticket;
}

class Client<E extends { type: string }> {
  events: E[] = [];
  private waiters: Array<() => void> = [];
  constructor(public ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (m) => {
      this.events.push(JSON.parse(m.data as string));
      this.waiters.splice(0).forEach((w) => w());
    });
  }
  send(ev: unknown) {
    this.ws.send(JSON.stringify(ev));
  }
  async next<T extends E['type']>(type: T, timeout = 3000): Promise<Extract<E, { type: T }>> {
    const start = Date.now();
    for (;;) {
      const i = this.events.findIndex((e) => e.type === type);
      if (i >= 0) return this.events.splice(i, 1)[0] as Extract<E, { type: T }>;
      if (Date.now() - start > timeout) throw new Error(`timeout waiting for ${type}; got ${JSON.stringify(this.events)}`);
      await new Promise<void>((res) => {
        this.waiters.push(res);
        setTimeout(res, 50);
      });
    }
  }
}

async function lobby(userId: string, blocked: string[] = []) {
  const t = await ticketFor(userId, blocked);
  const res = await SELF.fetch(`http://api/ws/lobby?ticket=${t}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
  expect(res.status).toBe(101);
  return new Client<LobbyServerEvent>(res.webSocket!);
}

async function roomSocket(sessionId: string, token: string) {
  const res = await SELF.fetch(`http://api/ws/room/${sessionId}?token=${encodeURIComponent(token)}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
  expect(res.status).toBe(101);
  return new Client<RoomServerEvent>(res.webSocket!);
}

describe('realtime integration', () => {
  it('rejects foreign origins and reused tickets', async () => {
    const t = await ticketFor('reuse-user');
    const bad = await SELF.fetch(`http://api/ws/lobby?ticket=${t}`, { headers: { Upgrade: 'websocket', Origin: 'https://evil.example' } });
    expect(bad.status).toBe(403);
    const ok = await SELF.fetch(`http://api/ws/lobby?ticket=${t}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
    expect(ok.status).toBe(101);
    ok.webSocket!.accept();
    const reused = await SELF.fetch(`http://api/ws/lobby?ticket=${t}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
    expect(reused.status).toBe(401);
    ok.webSocket!.close();
  });

  it('two users match, exchange messages both ways, and Next ends the session', async () => {
    const a = await lobby('it-a');
    const b = await lobby('it-b');
    await a.next('hello');
    await b.next('hello');
    a.send({ type: 'queue:join' });
    await a.next('queue:waiting');
    b.send({ type: 'queue:join' });
    const ma = await a.next('queue:matched');
    const mb = await b.next('queue:matched');
    expect(ma.sessionId).toBe(mb.sessionId);
    expect(ma.peer.displayName).toBe('N-it-b');

    const ra = await roomSocket(ma.sessionId, ma.roomToken);
    await ra.next('chat:ready');
    const rb = await roomSocket(mb.sessionId, mb.roomToken);
    await rb.next('chat:ready');

    // Reusing a room token fails (single-use nonce).
    const reuse = await SELF.fetch(`http://api/ws/room/${ma.sessionId}?token=${encodeURIComponent(ma.roomToken)}`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } });
    expect(reuse.status).toBe(401);

    ra.send({ type: 'chat:send', clientMsgId: 'client-aaa1', text: 'hello from A' });
    expect((await rb.next('chat:message')).message.text).toBe('hello from A');
    rb.send({ type: 'chat:send', clientMsgId: 'client-bbb1', text: 'hi from B 👋' });
    expect((await ra.next('chat:message')).message.text).toBe('hi from B 👋');

    a.send({ type: 'queue:next' });
    expect((await rb.next('chat:ended')).by).toBe('peer');
    await a.next('queue:waiting');
    // b can immediately search again and will be matched with a.
    await new Promise((r) => setTimeout(r, 100));
    b.send({ type: 'queue:join' });
    const again = await b.next('queue:matched');
    expect(again.sessionId).not.toBe(ma.sessionId);
  });

  it('blocked users are not paired', async () => {
    const x = await lobby('blk-x', ['blk-y']);
    const y = await lobby('blk-y');
    x.send({ type: 'queue:join' });
    await x.next('queue:waiting');
    y.send({ type: 'queue:join' });
    await y.next('queue:waiting');
    x.send({ type: 'queue:leave' });
    y.send({ type: 'queue:leave' });
  });
});
