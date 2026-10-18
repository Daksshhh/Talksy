import { describe, it, expect } from 'vitest';
import {
  parseLobbyClientEvent,
  parseRoomClientEvent,
  sanitizeText,
  segmentLinks,
  validateDisplayName,
  validateProfilePatch,
  validateReport,
  suggestNickname,
  charCount,
} from '../index';

describe('text sanitising', () => {
  it('keeps emoji/unicode, strips control and bidi-override chars', () => {
    const r = sanitizeText('  héllo 👩‍👩‍👧 \u202Eevil\u0007 ', 100);
    expect(r).toEqual({ ok: true, value: 'héllo 👩‍👩‍👧 evil' });
  });
  it('enforces max length in code points', () => {
    expect(sanitizeText('😀'.repeat(10), 10).ok).toBe(true);
    expect(sanitizeText('😀'.repeat(11), 10)).toMatchObject({ ok: false, error: 'too_long' });
    expect(charCount('😀😀')).toBe(2);
  });
  it('segments links for non-clickable rendering', () => {
    const s = segmentLinks('go to https://x.io/a now');
    expect(s.map((x) => x.type)).toEqual(['text', 'link', 'text']);
  });
});

describe('profile validation', () => {
  it('validates display names', () => {
    expect(validateDisplayName('Nova').ok).toBe(true);
    expect(validateDisplayName('A').ok).toBe(false);
    expect(validateDisplayName('Admin Bob').ok).toBe(false);
    expect(validateDisplayName('me@mail.com').ok).toBe(false);
    expect(validateDisplayName(suggestNickname()).ok).toBe(true);
  });
  it('rejects unknown fields (mass-assignment protection, e.g. isAdmin)', () => {
    expect(validateProfilePatch({ isAdmin: true }).ok).toBe(false);
    expect(validateProfilePatch({ id: 'x' }).ok).toBe(false);
  });
  it('accepts a full onboarding payload', () => {
    const r = validateProfilePatch({ displayName: 'CosmicFox12', gender: 'non_binary', language: 'pa', interests: ['music', 'Music', 'travel'], confirmAdult: true, acceptTerms: true, completeOnboarding: true });
    expect(r.ok && r.value.interests).toEqual(['music', 'travel']);
  });
  it('rejects bad enum values', () => {
    expect(validateProfilePatch({ gender: 'robot' }).ok).toBe(false);
    expect(validateProfilePatch({ language: 'klingon' }).ok).toBe(false);
  });
});

describe('report validation', () => {
  it('requires a known reason and context reference', () => {
    expect(validateReport({ reason: 'spam', context: 'random_chat', sessionId: '7d6f9f0e-1b2c-4d3e-8f90-123456789abc' }).ok).toBe(true);
    expect(validateReport({ reason: 'meh', context: 'random_chat', sessionId: '7d6f9f0e-1b2c-4d3e-8f90-123456789abc' }).ok).toBe(false);
    expect(validateReport({ reason: 'spam', context: 'dm' }).ok).toBe(false);
  });
});

describe('websocket protocol parsing', () => {
  it('parses valid lobby events and rejects unknown/extra fields', () => {
    expect(parseLobbyClientEvent('{"type":"queue:join"}').ok).toBe(true);
    expect(parseLobbyClientEvent('{"type":"queue:next"}').ok).toBe(true);
    expect(parseLobbyClientEvent('{"type":"queue:join","userId":"x"}').ok).toBe(false);
    expect(parseLobbyClientEvent('{"type":"queue:join","gender":"female"}').ok).toBe(false);
    expect(parseLobbyClientEvent('not json').ok).toBe(false);
    expect(parseLobbyClientEvent(new ArrayBuffer(4)).ok).toBe(false);
  });
  it('limits frame size', () => {
    expect(parseRoomClientEvent(JSON.stringify({ type: 'chat:send', clientMsgId: 'abcdefgh', text: 'x'.repeat(9000) })).ok).toBe(false);
  });
  it('validates room events', () => {
    expect(parseRoomClientEvent('{"type":"chat:send","clientMsgId":"abc","text":"hi"}').ok).toBe(false); // id too short
    expect(parseRoomClientEvent('{"type":"chat:typing","isTyping":"yes"}').ok).toBe(false);
    expect(parseRoomClientEvent('{"type":"quest:propose","category":"dating"}').ok).toBe(false);
    expect(parseRoomClientEvent('{"type":"chat:report","reason":"threats","details":"x","alsoBlock":true}').ok).toBe(true);
    expect(parseRoomClientEvent('{"type":"chat:leave","reason":"next"}').ok).toBe(true);
  });
});
