import { describe, it, expect, beforeEach } from 'vitest';
import { getQuestion, pickQuestion } from '@orbit/quest-content';
import { parseRoomClientEvent, type RoomClientEvent, type RoomServerEvent } from '@orbit/shared';
import { RoomEngine, type RoomEffect } from '../rooms/engine';

let clock = 0;
let idc = 0;
const opts = () => ({
  now: () => clock,
  newId: () => `id-${++idc}`,
  graceMs: 30_000,
  pickQuestion: (c: Parameters<typeof pickQuestion>[0], used: string[]) => pickQuestion(c, used, () => 0),
  getQuestion,
});
const P = (name: string) => ({ displayName: name, avatarSeed: 'seed1234', avatarStyle: 'orbit' });

let room: RoomEngine;
beforeEach(() => {
  clock = 1_000_000;
  idc = 0;
  room = RoomEngine.create('room-1', { userId: 'A', profile: P('Alice') }, { userId: 'B', profile: P('Bob') }, opts());
});

const sends = (fx: RoomEffect[], to: string) =>
  fx.filter((f): f is Extract<RoomEffect, { kind: 'send' }> => f.kind === 'send' && f.to === to).map((f) => f.event);
const ofType = <T extends RoomServerEvent['type']>(evs: RoomServerEvent[], t: T) =>
  evs.filter((e): e is Extract<RoomServerEvent, { type: T }> => e.type === t);
const send = (u: string, ev: RoomClientEvent) => room.handle(u, ev);
const msg = (u: string, text: string, id = `c-${Math.random().toString(36).slice(2, 12)}`) =>
  send(u, { type: 'chat:send', clientMsgId: id, text });

function activate() {
  room.connect('A');
  const fx = room.connect('B');
  expect(fx.some((f) => f.kind === 'activated')).toBe(true);
  expect(room.meta.status).toBe('ACTIVE');
}

describe('room lifecycle & messaging', () => {
  it('two users connect and messages travel both directions', () => {
    const fxA = room.connect('A');
    const ready = ofType(sends(fxA, 'A'), 'chat:ready')[0];
    expect(ready.peer.displayName).toBe('Bob');
    expect(ready.peerConnected).toBe(false);
    const fxB = room.connect('B');
    expect(ofType(sends(fxB, 'A'), 'chat:peer_status')[0].status).toBe('connected');

    const f1 = msg('A', 'hello 👋 from Alice');
    expect(ofType(sends(f1, 'A'), 'chat:ack')).toHaveLength(1);
    const toB = ofType(sends(f1, 'B'), 'chat:message')[0];
    expect(toB.message).toMatchObject({ from: 'peer', text: 'hello 👋 from Alice' });
    expect(toB.message.clientMsgId).toBeUndefined(); // never leak sender-side ids

    const f2 = msg('B', 'hi Alice — नमस्ते 🌍');
    expect(ofType(sends(f2, 'A'), 'chat:message')[0].message.text).toBe('hi Alice — नमस्ते 🌍');
  });

  it('sender identity is derived from the socket: forged ids in payload are rejected by the parser', () => {
    const forged = parseRoomClientEvent(JSON.stringify({ type: 'chat:send', clientMsgId: 'abcdefgh1', text: 'x', senderId: 'B' }));
    expect(forged.ok).toBe(false);
    const forged2 = parseRoomClientEvent(JSON.stringify({ type: 'chat:send', clientMsgId: 'abcdefgh1', text: 'x', userId: 'B' }));
    expect(forged2.ok).toBe(false);
  });

  it('cannot send before both participants connected', () => {
    room.connect('A');
    const fx = msg('A', 'too early');
    expect(ofType(sends(fx, 'A'), 'chat:rejected')[0].code).toBe('not_active');
  });

  it('retries with the same clientMsgId do not duplicate messages', () => {
    activate();
    const a = msg('A', 'once', 'client-0001');
    const b = msg('A', 'once', 'client-0001');
    expect(ofType(sends(a, 'B'), 'chat:message')).toHaveLength(1);
    expect(ofType(sends(b, 'B'), 'chat:message')).toHaveLength(0);
    expect(ofType(sends(b, 'A'), 'chat:ack')[0].id).toBe(ofType(sends(a, 'A'), 'chat:ack')[0].id);
    expect(room.messages).toHaveLength(1);
  });

  it('enforces length limits, emptiness and link limits', () => {
    activate();
    expect(ofType(sends(msg('A', 'x'.repeat(1001)), 'A'), 'chat:rejected')[0].code).toBe('too_long');
    expect(ofType(sends(msg('A', '   \n  '), 'A'), 'chat:rejected')[0].code).toBe('empty');
    const links = ofType(sends(msg('A', 'a.com b.com c.com d.com'), 'A'), 'chat:rejected')[0];
    expect(links.code).toBe('too_many_links');
    const one = msg('A', 'see https://example.com');
    expect(ofType(sends(one, 'B'), 'chat:message')[0].message.hasLink).toBe(true);
  });

  it('flood detection blocks repeated identical messages', () => {
    activate();
    msg('A', 'BUY NOW');
    clock += 1000;
    msg('A', 'buy   now');
    clock += 1000;
    const third = msg('A', 'Buy now');
    expect(ofType(sends(third, 'A'), 'chat:rejected')[0].code).toBe('flood');
  });

  it('rate limits bursts', () => {
    activate();
    let rejected = 0;
    for (let i = 0; i < 12; i++) {
      const fx = msg('A', `message number ${i}`);
      rejected += ofType(sends(fx, 'A'), 'chat:rejected').length;
    }
    expect(rejected).toBe(4); // 8 per 5s allowed
  });

  it('repeated abuse strikes end the session with moderation reason', () => {
    activate();
    let ended: RoomEffect[] = [];
    for (let i = 0; i < 30 && !room.ended; i++) ended = msg('A', `spam ${i}`);
    expect(room.ended).toBe(true);
    expect(ended.some((f) => f.kind === 'safety_event')).toBe(true);
    expect(room.meta.endReason).toBe('moderation');
  });

  it('typing indicators are forwarded only on change', () => {
    activate();
    expect(ofType(sends(send('A', { type: 'chat:typing', isTyping: true }), 'B'), 'chat:typing')).toHaveLength(1);
    expect(sends(send('A', { type: 'chat:typing', isTyping: true }), 'B')).toHaveLength(0);
    expect(ofType(sends(send('A', { type: 'chat:typing', isTyping: false }), 'B'), 'chat:typing')).toHaveLength(1);
  });

  it('Next/leave ends the room for both, informing the other participant', () => {
    activate();
    const fx = send('A', { type: 'chat:leave', reason: 'next' });
    expect(ofType(sends(fx, 'B'), 'chat:ended')[0]).toMatchObject({ reason: 'next', by: 'peer' });
    expect(ofType(sends(fx, 'A'), 'chat:ended')[0]).toMatchObject({ by: 'me' });
    expect(fx.filter((f) => f.kind === 'close')).toHaveLength(2);
    expect(fx.some((f) => f.kind === 'ended')).toBe(true);
    expect(room.messages).toHaveLength(0); // buffer purged
    // idempotent
    expect(room.end('left', 'B')).toEqual([]);
    expect(ofType(sends(msg('B', 'hello?'), 'B'), 'chat:rejected')[0].code).toBe('not_active');
  });

  it('disconnect -> reconnect within grace restores the session and history', () => {
    activate();
    msg('A', 'before refresh');
    const d = room.disconnect('A');
    expect(ofType(sends(d, 'B'), 'chat:peer_status')[0].status).toBe('reconnecting');
    expect(room.meta.status).toBe('RECONNECTING');
    clock += 10_000;
    expect(room.tick()).toEqual([]);
    const r = room.connect('A');
    const ready = ofType(sends(r, 'A'), 'chat:ready')[0];
    expect(ready.messages.map((m) => m.text)).toEqual(['before refresh']);
    expect(ready.messages[0].from).toBe('me');
    expect(room.meta.status).toBe('ACTIVE');
  });

  it('disconnect beyond grace ends the session (timeout)', () => {
    activate();
    room.disconnect('B');
    expect(room.nextDeadline()).toBe(clock + 30_000);
    clock += 30_001;
    const fx = room.tick();
    expect(ofType(sends(fx, 'A'), 'chat:ended')[0]).toMatchObject({ reason: 'timeout', by: 'peer' });
  });

  it('a room whose participant never connects expires', () => {
    room.connect('A');
    clock += 31_000;
    const fx = room.tick();
    expect(ofType(sends(fx, 'A'), 'chat:ended')[0]).toMatchObject({ reason: 'expired', by: 'system' });
  });

  it('room tokens are single-use (nonce)', () => {
    expect(room.consumeNonce('n1')).toBe(true);
    expect(room.consumeNonce('n1')).toBe(false);
  });
});

describe('save conversation consent', () => {
  it('requires both participants; decline retains nothing', () => {
    activate();
    msg('A', 'hello');
    const r = send('A', { type: 'chat:save_request' });
    expect(ofType(sends(r, 'B'), 'chat:save_state')[0].state).toBe('requested_by_peer');
    const d = send('B', { type: 'chat:save_respond', accept: false });
    expect(ofType(sends(d, 'A'), 'chat:save_state')[0].state).toBe('declined');
    const end = send('A', { type: 'chat:leave', reason: 'left' });
    expect(end.some((f) => f.kind === 'save_transcript')).toBe(false);
  });

  it('mutual consent saves the transcript at the end', () => {
    activate();
    msg('A', 'hello');
    msg('B', 'hey');
    send('A', { type: 'chat:save_request' });
    // requester cannot accept their own request
    expect(send('A', { type: 'chat:save_respond', accept: true })).toEqual([]);
    const ok = send('B', { type: 'chat:save_respond', accept: true });
    expect(ofType(sends(ok, 'A'), 'chat:save_state')[0].state).toBe('saved');
    const end = send('B', { type: 'chat:leave', reason: 'left' });
    const save = end.find((f) => f.kind === 'save_transcript');
    expect(save && save.kind === 'save_transcript' && save.messages.map((m) => m.text)).toEqual(['hello', 'hey']);
  });
});

describe('reporting', () => {
  it('captures minimal labelled evidence without user ids and can block', () => {
    activate();
    msg('A', 'hi');
    msg('B', 'something abusive');
    const fx = send('A', { type: 'chat:report', reason: 'harassment', details: 'rude', alsoBlock: true });
    const rep = fx.find((f) => f.kind === 'report');
    expect(rep && rep.kind === 'report' && rep.reportedId).toBe('B');
    if (rep && rep.kind === 'report') {
      expect(rep.evidence.map((e) => e.from)).toEqual(['reporter', 'reported']);
      expect(JSON.stringify(rep.evidence)).not.toContain('"A"');
    }
    expect(room.meta.endReason).toBe('blocked');
  });
});

describe('Conversation Quest', () => {
  it('propose -> accept -> both answer -> reveal -> next -> end', () => {
    activate();
    const p = send('A', { type: 'quest:propose', category: 'would_you_rather' });
    const bView = ofType(sends(p, 'B'), 'quest:state')[0].quest!;
    expect(bView).toMatchObject({ status: 'proposed', proposedBy: 'peer' });
    // proposer cannot accept their own invitation
    expect(ofType(sends(send('A', { type: 'quest:respond', accept: true }), 'A'), 'chat:rejected')).toHaveLength(1);
    const acc = send('B', { type: 'quest:respond', accept: true });
    const q = ofType(sends(acc, 'A'), 'quest:state')[0].quest!;
    expect(q.status).toBe('active');
    expect(q.round).toBe(1);
    const question = q.question!;
    const a1 = send('A', { type: 'quest:answer', questionId: question.id, answer: question.options![0] });
    const viewB = ofType(sends(a1, 'B'), 'quest:state')[0].quest!;
    expect(viewB.peerAnswered).toBe(true);
    expect(viewB.reveal).toBeUndefined(); // no peeking before both answer
    const a2 = send('B', { type: 'quest:answer', questionId: question.id, answer: question.options![0] });
    const revealA = ofType(sends(a2, 'A'), 'quest:state')[0].quest!;
    expect(revealA.status).toBe('revealed');
    expect(revealA.reveal!.sameChoice).toBe(true);
    const nx = send('B', { type: 'quest:next' });
    const q2 = ofType(sends(nx, 'A'), 'quest:state')[0].quest!;
    expect(q2.round).toBe(2);
    expect(q2.question!.id).not.toBe(question.id);
    const end = send('A', { type: 'quest:end' });
    expect(end.some((f) => f.kind === 'quest_summary')).toBe(true);
    expect(ofType(sends(end, 'B'), 'quest:state')[0].quest).toBeNull();
  });

  it('declining an invitation clears it; skip moves to a new question', () => {
    activate();
    send('A', { type: 'quest:propose', category: 'icebreakers' });
    const d = send('B', { type: 'quest:respond', accept: false });
    expect(ofType(sends(d, 'A'), 'quest:state')[0].quest).toBeNull();
    send('B', { type: 'quest:propose', category: 'icebreakers' });
    const acc = send('A', { type: 'quest:respond', accept: true });
    const first = ofType(sends(acc, 'A'), 'quest:state')[0].quest!.question!.id;
    const sk = send('A', { type: 'quest:skip' });
    expect(ofType(sends(sk, 'B'), 'quest:state')[0].quest!.question!.id).not.toBe(first);
  });

  it('guess questions require a valid guess and score both guesses', () => {
    activate();
    send('A', { type: 'quest:propose', category: 'guess' });
    const acc = send('B', { type: 'quest:respond', accept: true });
    const q = ofType(sends(acc, 'A'), 'quest:state')[0].quest!.question!;
    const [o1, o2] = q.options!;
    expect(ofType(sends(send('A', { type: 'quest:answer', questionId: q.id, answer: o1 }), 'A'), 'chat:rejected')).toHaveLength(1);
    send('A', { type: 'quest:answer', questionId: q.id, answer: o1, guess: o2 });
    const r = send('B', { type: 'quest:answer', questionId: q.id, answer: o2, guess: o2 });
    const view = ofType(sends(r, 'A'), 'quest:state')[0].quest!;
    expect(view.reveal).toMatchObject({ myGuessCorrect: true, peerGuessCorrect: false });
  });

  it('rejects stale question ids and answers outside the options', () => {
    activate();
    send('A', { type: 'quest:propose', category: 'this_or_that' });
    const acc = send('B', { type: 'quest:respond', accept: true });
    const q = ofType(sends(acc, 'A'), 'quest:state')[0].quest!.question!;
    expect(ofType(sends(send('A', { type: 'quest:answer', questionId: 'nope', answer: 'x' }), 'A'), 'chat:rejected')).toHaveLength(1);
    expect(ofType(sends(send('A', { type: 'quest:answer', questionId: q.id, answer: 'Neither' }), 'A'), 'chat:rejected')).toHaveLength(1);
  });
});
