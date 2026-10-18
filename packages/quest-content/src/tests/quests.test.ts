import { describe, it, expect } from 'vitest';
import { QUESTIONS, QUEST_CATEGORIES, pickQuestion, questionsFor } from '../index';

describe('quest content', () => {
  it('has unique ids and questions for every category', () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
    for (const c of QUEST_CATEGORIES) expect(questionsFor(c.id).length).toBeGreaterThan(3);
  });
  it('choice and guess questions have options', () => {
    for (const q of QUESTIONS) if (q.kind !== 'open') expect((q.options ?? []).length).toBeGreaterThan(1);
  });
  it('pickQuestion avoids used questions until the pack is exhausted', () => {
    const used: string[] = [];
    const pool = questionsFor('this_or_that');
    for (let i = 0; i < pool.length; i++) used.push(pickQuestion('this_or_that', used).id);
    expect(new Set(used).size).toBe(pool.length);
    expect(pickQuestion('this_or_that', used).category).toBe('this_or_that');
  });
  it('does not ask for identifying details', () => {
    const banned = /(real name|your age|how old|address|phone number|instagram|snapchat|your school|which school|photo|where do you live)/i;
    for (const q of QUESTIONS) expect(banned.test(q.text)).toBe(false);
  });
});
