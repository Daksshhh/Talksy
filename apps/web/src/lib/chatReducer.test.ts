import { describe, it, expect } from 'vitest';
import type { ChatMessageView } from '@orbit/shared';
import { addPending, initialChat, markFailed, reduceRoomEvent, resetSession, type ChatState } from './chatReducer';

const peer = { displayName: 'Bob', avatarSeed: 'seed1234', avatarStyle: 'orbit' };
const ready = (s: ChatState, messages: ChatMessageView[] = []) =>
  reduceRoomEvent(s, { type: 'chat:ready', sessionId: 's1', you: peer, peer, peerConnected: true, startedAt: 1, messages, quest: null, save: 'none' });

describe('chat reducer', () => {
  it('becomes matched only on server-confirmed chat:ready', () => {
    const s = resetSession(initialChat, 'searching');
    expect(s.phase).toBe('searching');
    const r = ready(s);
    expect(r.phase).toBe('matched');
    expect(r.roomReady).toBe(true);
  });

  it('optimistic message -> ack updates in place without duplicates', () => {
    let s = ready(initialChat);
    s = addPending(s, 'client-1', 'hello', 10);
    expect(s.messages[0].status).toBe('sending');
    s = reduceRoomEvent(s, { type: 'chat:ack', clientMsgId: 'client-1', id: 'srv-1', ts: 11 });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ id: 'srv-1', status: 'sent' });
    // duplicate ack (retry) is harmless
    s = reduceRoomEvent(s, { type: 'chat:ack', clientMsgId: 'client-1', id: 'srv-1', ts: 11 });
    expect(s.messages).toHaveLength(1);
  });

  it('ignores duplicate incoming messages and clears typing', () => {
    let s = reduceRoomEvent(ready(initialChat), { type: 'chat:typing', isTyping: true });
    const ev = { type: 'chat:message' as const, message: { id: 'm1', from: 'peer' as const, text: 'yo', ts: 5 } };
    s = reduceRoomEvent(s, ev);
    s = reduceRoomEvent(s, ev);
    expect(s.messages).toHaveLength(1);
    expect(s.peerTyping).toBe(false);
  });

  it('rejections mark the specific message failed', () => {
    let s = addPending(ready(initialChat), 'c2', 'spam', 1);
    s = reduceRoomEvent(s, { type: 'chat:rejected', clientMsgId: 'c2', code: 'flood', message: 'no' });
    expect(s.messages[0]).toMatchObject({ status: 'failed', error: 'no' });
  });

  it('chat:ended never leaves a connected state behind', () => {
    let s = addPending(ready(initialChat), 'c3', 'bye', 1);
    s = reduceRoomEvent(s, { type: 'chat:ended', reason: 'next', by: 'peer' });
    expect(s).toMatchObject({ phase: 'ended', roomReady: false, peerConnected: false, endedBy: 'peer' });
    expect(s.messages[0].status).toBe('failed');
  });

  it('resume (chat:ready again) merges server history and keeps unsent local messages for retry', () => {
    let s = addPending(ready(initialChat), 'c4', 'lost in transit', 50);
    s = markFailed(s, 'c4', 'Not delivered');
    s = ready(s, [{ id: 'm0', from: 'peer', text: 'earlier', ts: 10 }]);
    expect(s.messages.map((m) => m.text)).toEqual(['earlier', 'lost in transit']);
    expect(s.messages[1].status).toBe('failed');
  });

  it('friend request events track state from both sides', () => {
    let s = reduceRoomEvent(ready(initialChat), { type: 'chat:friend_request', direction: 'incoming', status: 'pending' });
    expect(s.friendRequest).toBe('received');
    s = reduceRoomEvent(s, { type: 'chat:friend_request', direction: 'outgoing', status: 'accepted' });
    expect(s.friendRequest).toBe('friends');
  });
});
