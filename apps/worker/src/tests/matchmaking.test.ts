import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MatchEngine, type MatchProfile } from '../matchmaking/engine';

type Gender = 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
type Auth = 'guest' | 'google';

/**
 * Test fixture users carry gender/auth metadata ONLY in the test harness.
 * The engine API has no parameter that could accept it.
 */
interface TestUser {
  id: string;
  gender: Gender;
  auth: Auth;
}

let clock = 1_000_000;
let roomCounter = 0;
let engine: MatchEngine;

const profile = (id: string): MatchProfile => ({ displayName: `user-${id}`, avatarSeed: 'abcd1234', avatarStyle: 'orbit' });

function connect(u: TestUser | string, blocked: string[] = []) {
  const id = typeof u === 'string' ? u : u.id;
  return engine.connect(id, profile(id), blocked);
}

beforeEach(() => {
  clock = 1_000_000;
  roomCounter = 0;
  engine = new MatchEngine({
    now: () => clock,
    newRoomId: () => `room-${++roomCounter}`,
    staleMs: 65_000,
    orphanMatchMs: 180_000,
  });
});

function expectPaired(a: TestUser, b: TestUser) {
  connect(a);
  connect(b);
  expect(engine.join(a.id).type).toBe('queued');
  clock += 100;
  const r = engine.join(b.id);
  expect(r.type).toBe('matched');
  if (r.type !== 'matched') return;
  expect(new Set([r.userA.userId, r.userB.userId])).toEqual(new Set([a.id, b.id]));
  expect(engine.get(a.id)!.peerId).toBe(b.id);
  expect(engine.get(b.id)!.peerId).toBe(a.id);
}

describe('gender-independent first-available matching', () => {
  const M = (id: string, auth: Auth = 'guest'): TestUser => ({ id, gender: 'male', auth });
  const F = (id: string, auth: Auth = 'guest'): TestUser => ({ id, gender: 'female', auth });
  const NB = (id: string, auth: Auth = 'guest'): TestUser => ({ id, gender: 'non_binary', auth });
  const P = (id: string, auth: Auth = 'guest'): TestUser => ({ id, gender: 'prefer_not_to_say', auth });

  it('1. Male + Female match', () => expectPaired(M('m1'), F('f1')));
  it('2. Male + Male match', () => expectPaired(M('m1'), M('m2')));
  it('3. Female + Female match', () => expectPaired(F('f1'), F('f2')));
  it('4. Female + Male match', () => expectPaired(F('f1'), M('m1')));
  it('5. Non-binary users match without restriction', () => {
    expectPaired(NB('n1'), M('m1'));
    beforeEachReset();
    expectPaired(NB('n1'), F('f1'));
    beforeEachReset();
    expectPaired(NB('n1'), NB('n2'));
    beforeEachReset();
    expectPaired(P('p1'), NB('n1'));
  });
  it('6. Anonymous guests match registered users', () => expectPaired(M('guest1', 'guest'), F('google1', 'google')));
  it('7. Google users match other Google users', () => expectPaired(F('g1', 'google'), F('g2', 'google')));

  it('pairing order is FIFO (oldest eligible first) and ignores any user attributes', () => {
    // a and b blocked each other so both stay waiting; then c and d arrive.
    connect(F('a'), ['b']);
    connect(M('b'));
    connect(M('c'));
    connect(NB('d'));
    expect(engine.join('a').type).toBe('queued');
    clock += 1;
    expect(engine.join('b').type).toBe('queued');
    clock += 1;
    const r = engine.join('c');
    // c gets the OLDEST waiting user "a" — not chosen by any attribute.
    expect(r.type === 'matched' && r.userA.userId).toBe('a');
    const r2 = engine.join('d');
    expect(r2.type === 'matched' && r2.userA.userId).toBe('b');
  });

  it('the pairing engine source never references gender', () => {
    const src = readFileSync(fileURLToPath(new URL('../matchmaking/engine.ts', import.meta.url)), 'utf8');
    expect(/gender/i.test(src)).toBe(false);
    const coord = readFileSync(fileURLToPath(new URL('../matchmaking/coordinator.ts', import.meta.url)), 'utf8');
    expect(/gender/i.test(coord)).toBe(false);
  });
});

function beforeEachReset() {
  clock = 1_000_000;
  engine = new MatchEngine({ now: () => clock, newRoomId: () => `room-${++roomCounter}`, staleMs: 65_000, orphanMatchMs: 180_000 });
}

describe('queue safety', () => {
  it('8. three queued users never create duplicate matches', () => {
    ['a', 'b', 'c'].forEach((id) => connect(id));
    const results = ['a', 'b', 'c'].map((id) => engine.join(id));
    expect(results.map((r) => r.type)).toEqual(['queued', 'matched', 'queued']);
    const matchedUsers = [...engine.users.values()].filter((u) => u.state === 'MATCHED').map((u) => u.userId);
    expect(matchedUsers.sort()).toEqual(['a', 'b']);
    expect(engine.get('c')!.state).toBe('QUEUED');
    expect(engine.queueSnapshot()).toEqual(['c']);
  });

  it('9. a user cannot match themselves (double join is idempotent)', () => {
    connect('solo');
    expect(engine.join('solo').type).toBe('queued');
    const again = engine.join('solo');
    expect(again).toMatchObject({ type: 'queued', duplicate: true });
    expect(engine.queueSnapshot()).toEqual(['solo']);
    // Two sockets for the same user still produce a single queue entry.
    connect('solo');
    expect(engine.join('solo').type).toBe('queued');
    expect(engine.queueSnapshot()).toEqual(['solo']);
  });

  it('10. blocked users are never paired (either direction), next eligible is used', () => {
    connect('a', ['b']);
    connect('b');
    connect('c');
    engine.join('a');
    const rb = engine.join('b');
    expect(rb.type).toBe('queued');
    const rc = engine.join('c');
    expect(rc.type === 'matched' && rc.userA.userId).toBe('a');
    expect(engine.get('b')!.state).toBe('QUEUED');

    // reverse direction: blocker joins second
    beforeEachReset();
    connect('x');
    connect('y', ['x']);
    engine.join('x');
    expect(engine.join('y').type).toBe('queued');
  });

  it('11. a disconnected queued user is removed', () => {
    connect('a');
    engine.join('a');
    engine.disconnect('a');
    expect(engine.queueSnapshot()).toEqual([]);
    connect('b');
    expect(engine.join('b').type).toBe('queued');
  });

  it('stale queued users (no heartbeat) are skipped and pruned', () => {
    connect('old');
    engine.join('old');
    clock += 70_000; // beyond staleMs without heartbeat
    connect('fresh1');
    connect('fresh2');
    expect(engine.join('fresh1').type).toBe('queued');
    expect(engine.queueSnapshot()).toEqual(['fresh1']);
    expect(engine.join('fresh2').type).toBe('matched');
  });

  it('heartbeats keep waiting users eligible', () => {
    connect('a');
    engine.join('a');
    for (let i = 0; i < 5; i++) {
      clock += 20_000;
      engine.heartbeat('a');
    }
    connect('b');
    expect(engine.join('b').type).toBe('matched');
  });

  it('12. Next releases the prior session and requeues correctly', () => {
    ['a', 'b', 'c'].forEach((id) => connect(id));
    engine.join('a');
    const m = engine.join('b');
    expect(m.type).toBe('matched');
    engine.join('c'); // c waiting
    const n = engine.next('a');
    expect(n.endedRoomId).toBe('room-1');
    expect(n.released.sort()).toEqual(['a', 'b']);
    expect(n.result.type === 'matched' && n.result.userA.userId).toBe('c');
    expect(engine.get('b')!.state).toBe('IDLE');
    expect(engine.get('b')!.roomId).toBeNull();
    // b can search again and is not stuck
    expect(engine.join('b').type).toBe('queued');
  });

  it('Next with nobody waiting puts the user back in the queue', () => {
    connect('a');
    connect('b');
    engine.join('a');
    engine.join('b');
    const n = engine.next('b');
    expect(n.result.type).toBe('queued');
    expect(engine.queueSnapshot()).toEqual(['b']);
    // a is idle and could immediately re-match with b
    expect(engine.join('a').type).toBe('matched');
  });

  it('13. simultaneous matching operations do not double-assign users', () => {
    const ids = Array.from({ length: 101 }, (_, i) => `u${i}`);
    ids.forEach((id) => connect(id));
    // interleave joins in random-ish order, as concurrent arrivals would be serialized by the DO
    const order = [...ids].sort((x, y) => ((x.charCodeAt(1) * 7) % 13) - ((y.charCodeAt(1) * 7) % 13));
    for (const id of order) engine.join(id);
    const rooms = new Map<string, string[]>();
    for (const u of engine.users.values()) {
      if (u.roomId) rooms.set(u.roomId, [...(rooms.get(u.roomId) ?? []), u.userId]);
    }
    for (const members of rooms.values()) expect(members.length).toBe(2);
    expect(rooms.size).toBe(50);
    expect(engine.queueSnapshot().length).toBe(1);
    // every matched user's peer points back at them
    for (const u of engine.users.values()) {
      if (u.peerId) expect(engine.get(u.peerId)!.peerId).toBe(u.userId);
    }
  });

  it('14. refresh during reconnect grace does not create a second session', () => {
    connect('a');
    connect('b');
    engine.join('a');
    const m = engine.join('b');
    expect(m.type).toBe('matched');
    // a refreshes: lobby socket drops and reconnects
    engine.disconnect('a');
    expect(engine.get('a')!.state).toBe('MATCHED');
    connect('a');
    const again = engine.join('a');
    expect(again).toMatchObject({ type: 'error', code: 'already_in_session', roomId: 'room-1' });
    const roomIds = new Set([...engine.users.values()].map((u) => u.roomId).filter(Boolean));
    expect(roomIds.size).toBe(1);
  });

  it('a matched user cannot be matched again while in a session', () => {
    ['a', 'b', 'c'].forEach((id) => connect(id));
    engine.join('a');
    engine.join('b');
    expect(engine.join('a').type).toBe('error');
    expect(engine.join('c').type).toBe('queued');
  });

  it('block during a session ends the room and prevents rematch', () => {
    connect('a');
    connect('b');
    engine.join('a');
    engine.join('b');
    const ended = engine.block('a', 'b');
    expect(ended).toBe('room-1');
    expect(engine.get('a')!.state).toBe('IDLE');
    engine.join('a');
    expect(engine.join('b').type).toBe('queued');
  });

  it('leave removes from queue; endRoom is idempotent', () => {
    connect('a');
    engine.join('a');
    expect(engine.leave('a')).toBe(true);
    expect(engine.queueSnapshot()).toEqual([]);
    connect('b');
    engine.join('a');
    engine.join('b');
    expect(engine.endRoom('room-1').sort()).toEqual(['a', 'b']);
    expect(engine.endRoom('room-1')).toEqual([]);
  });

  it('restore() rebuilds FIFO order and drops transient MATCHING state', () => {
    ['a', 'b', 'c'].forEach((id) => connect(id));
    engine.join('a');
    clock += 5;
    engine.join('b'); // matched with a
    engine.join('c');
    const snapshot = [...engine.users.values()].map((u) => JSON.parse(JSON.stringify(u)));
    const e2 = new MatchEngine({ now: () => clock, newRoomId: () => 'r2', staleMs: 65_000, orphanMatchMs: 180_000 });
    e2.restore(snapshot, engine.queueSeqCounter);
    expect(e2.queueSnapshot()).toEqual(['c']);
    expect(e2.get('a')!.roomId).toBe('room-1');
  });

  it('presence & stats reflect real state only', () => {
    expect(engine.stats()).toEqual({ online: 0, waiting: 0, inChat: 0 });
    connect('a');
    connect('b');
    connect('c');
    engine.join('a');
    engine.join('b');
    engine.join('c');
    expect(engine.stats()).toEqual({ online: 3, waiting: 1, inChat: 2 });
    expect(engine.presenceOf('a')).toBe('in_chat');
    expect(engine.presenceOf('c')).toBe('searching');
    expect(engine.presenceOf('nobody')).toBe('offline');
    engine.disconnect('c');
    clock += 70_000;
    expect(engine.presenceOf('c')).toBe('offline');
  });

  it('sweep removes expired queue entries and forgets idle users', () => {
    connect('a');
    engine.join('a');
    clock += 70_000;
    const r = engine.sweep(30 * 60_000);
    expect(r.removedFromQueue).toEqual(['a']);
    engine.disconnect('a');
    clock += 31 * 60_000;
    expect(engine.sweep(30 * 60_000).forgotten).toEqual(['a']);
  });
});
