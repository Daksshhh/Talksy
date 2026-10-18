import type { QuestCategoryId, QuestKind, QuestQuestionView } from '@orbit/shared';

/**
 * Conversation Quest question packs.
 * Content rules: light, inclusive, no requests for identifying info (real name,
 * age, school, address, socials, photos), nothing sexual, nothing that pressures
 * people to disclose sensitive personal details. Add new packs by appending
 * questions with a stable unique `id`.
 */
export interface QuestQuestion extends QuestQuestionView {}

export interface QuestCategoryInfo {
  id: QuestCategoryId;
  label: string;
  description: string;
  emoji: string;
}

export const QUEST_CATEGORIES: QuestCategoryInfo[] = [
  { id: 'this_or_that', label: 'This or That', description: 'Quick picks, instant opinions.', emoji: '⚡' },
  { id: 'would_you_rather', label: 'Would You Rather', description: 'Tough choices, fun debates.', emoji: '🤔' },
  { id: 'two_truths', label: 'Two Truths and a Lie', description: 'Share three statements — spot the fib.', emoji: '🕵️' },
  { id: 'culture', label: 'Culture Exchange', description: 'Food, festivals and traditions.', emoji: '🌍' },
  { id: 'icebreakers', label: 'Fun Icebreakers', description: 'Easy, light-hearted openers.', emoji: '🧊' },
  { id: 'deep', label: 'Deep Questions', description: 'Thoughtful, never too personal.', emoji: '🌌' },
  { id: 'guess', label: 'Guess the Answer', description: 'Pick yours, then guess theirs.', emoji: '🎯' },
];

const q = (
  category: QuestCategoryId,
  n: number,
  kind: QuestKind,
  text: string,
  options?: string[],
  hint?: string,
): QuestQuestion => ({ id: `${category}-${n}`, category, kind, text, options, hint });

export const QUESTIONS: QuestQuestion[] = [
  // This or That
  q('this_or_that', 1, 'choice', 'Sunrise or sunset?', ['Sunrise', 'Sunset']),
  q('this_or_that', 2, 'choice', 'Mountains or beaches?', ['Mountains', 'Beaches']),
  q('this_or_that', 3, 'choice', 'Coffee or tea?', ['Coffee', 'Tea']),
  q('this_or_that', 4, 'choice', 'Books or movies?', ['Books', 'Movies']),
  q('this_or_that', 5, 'choice', 'City lights or quiet countryside?', ['City', 'Countryside']),
  q('this_or_that', 6, 'choice', 'Cats or dogs?', ['Cats', 'Dogs']),
  q('this_or_that', 7, 'choice', 'Sweet or savory snacks?', ['Sweet', 'Savory']),
  q('this_or_that', 8, 'choice', 'Early bird or night owl?', ['Early bird', 'Night owl']),
  q('this_or_that', 9, 'choice', 'Road trip or flight?', ['Road trip', 'Flight']),
  q('this_or_that', 10, 'choice', 'Texting or voice notes?', ['Texting', 'Voice notes']),
  // Would You Rather
  q('would_you_rather', 1, 'choice', 'Would you rather travel anywhere for free or speak every language?', ['Travel free', 'Speak every language']),
  q('would_you_rather', 2, 'choice', 'Would you rather be able to fly or be invisible?', ['Fly', 'Invisible']),
  q('would_you_rather', 3, 'choice', 'Would you rather live in the past or the future?', ['Past', 'Future']),
  q('would_you_rather', 4, 'choice', 'Would you rather never use social media again or never watch another movie?', ['No social media', 'No movies']),
  q('would_you_rather', 5, 'choice', 'Would you rather have a personal chef or a personal driver?', ['Chef', 'Driver']),
  q('would_you_rather', 6, 'choice', 'Would you rather explore space or the deep ocean?', ['Space', 'Deep ocean']),
  q('would_you_rather', 7, 'choice', 'Would you rather always be 10 minutes early or 10 minutes late?', ['Early', 'Late']),
  q('would_you_rather', 8, 'choice', 'Would you rather talk to animals or play every instrument?', ['Talk to animals', 'Play every instrument']),
  q('would_you_rather', 9, 'choice', 'Would you rather have summer forever or winter forever?', ['Summer', 'Winter']),
  // Two Truths and a Lie
  q('two_truths', 1, 'open', 'Share two truths and a lie about your hobbies.', undefined, 'Keep it fun — no personal details like names, school or location. Your partner guesses the lie after the reveal.'),
  q('two_truths', 2, 'open', 'Two truths and a lie about food you have tried.', undefined, 'Example: "I have eaten durian / I hate chocolate / I can make sushi".'),
  q('two_truths', 3, 'open', 'Two truths and a lie about places you would love to visit.', undefined, 'Dream destinations count too!'),
  q('two_truths', 4, 'open', 'Two truths and a lie about your skills or talents.', undefined, 'Weird talents encouraged.'),
  q('two_truths', 5, 'open', 'Two truths and a lie about movies or shows you like.', undefined, 'Then guess each other\'s lie in the chat.'),
  // Culture Exchange
  q('culture', 1, 'open', 'What is a dish everyone should try from where you grew up?'),
  q('culture', 2, 'open', 'What festival or celebration do you enjoy most, and why?'),
  q('culture', 3, 'open', 'What is a common phrase or saying in your language that you love?'),
  q('culture', 4, 'open', 'What is a song or artist people should listen to from your culture?'),
  q('culture', 5, 'open', 'What is a polite custom that might surprise visitors?'),
  q('culture', 6, 'open', 'What is a typical breakfast for you?'),
  // Icebreakers
  q('icebreakers', 1, 'open', 'What is the best thing that happened to you this week?'),
  q('icebreakers', 2, 'open', 'If you had a theme song, what would it be?'),
  q('icebreakers', 3, 'open', 'What is a random fact you know that most people do not?'),
  q('icebreakers', 4, 'open', 'What fictional world would you like to live in?'),
  q('icebreakers', 5, 'open', 'What is your go-to comfort snack?'),
  q('icebreakers', 6, 'open', 'Describe your perfect lazy day in five words.'),
  q('icebreakers', 7, 'open', 'What app on your phone do you use way too much?'),
  // Deep Questions (thoughtful but not sensitive)
  q('deep', 1, 'open', 'What is something you changed your mind about in the last few years?'),
  q('deep', 2, 'open', 'What does a really good day look like for you?'),
  q('deep', 3, 'open', 'What is a small habit that improved your life?'),
  q('deep', 4, 'open', 'Who or what inspires you lately?'),
  q('deep', 5, 'open', 'What is a skill you wish everyone learned at school?'),
  q('deep', 6, 'open', 'If you could give your younger self one piece of advice, what would it be?', undefined, 'Share only what you are comfortable with.'),
  // Guess the Answer
  q('guess', 1, 'guess', 'Which season do you enjoy most?', ['Spring', 'Summer', 'Autumn', 'Winter']),
  q('guess', 2, 'guess', 'Pick a superpower:', ['Teleport', 'Read minds', 'Time travel', 'Super strength']),
  q('guess', 3, 'guess', 'Favourite way to spend a weekend?', ['Outdoors', 'Gaming', 'With friends', 'Sleeping in']),
  q('guess', 4, 'guess', 'Pick a pizza topping:', ['Mushrooms', 'Pineapple', 'Pepperoni', 'Just cheese']),
  q('guess', 5, 'guess', 'Which movie genre would you pick tonight?', ['Comedy', 'Horror', 'Sci-fi', 'Romance']),
  q('guess', 6, 'guess', 'Your ideal pet?', ['Dog', 'Cat', 'Bird', 'Something unusual']),
];

const BY_ID = new Map(QUESTIONS.map((x) => [x.id, x]));

export function getQuestion(id: string): QuestQuestion | undefined {
  return BY_ID.get(id);
}

export function questionsFor(category: QuestCategoryId): QuestQuestion[] {
  return QUESTIONS.filter((x) => x.category === category);
}

/** Pick a random unused question from a category; cycles when the pack is exhausted. */
export function pickQuestion(
  category: QuestCategoryId,
  used: ReadonlySet<string> | readonly string[],
  rand: () => number = Math.random,
): QuestQuestion {
  const usedSet = used instanceof Set ? used : new Set(used as readonly string[]);
  const pool = questionsFor(category);
  const fresh = pool.filter((x) => !usedSet.has(x.id));
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(rand() * list.length)] ?? pool[0];
}
