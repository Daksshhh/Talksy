import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Sparkles, SkipForward, X } from 'lucide-react';
import { QUEST_CATEGORIES } from '@orbit/quest-content';
import { LIMITS, type QuestCategoryId, type QuestView } from '@orbit/shared';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Field';
import { chatClient } from '@/services/chatClient';
import { cn } from '@/lib/utils';

export function QuestPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pick = (id: QuestCategoryId) => {
    chatClient.questPropose(id);
    onClose();
  };
  return (
    <Dialog open={open} onClose={onClose} title="Start a Conversation Quest" description="Pick a category. The stranger has to accept before it starts — totally optional, totally free.">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {QUEST_CATEGORIES.map((c) => (
          <button key={c.id} onClick={() => pick(c.id)} className="flex items-start gap-3 rounded-2xl border border-border p-3.5 text-left transition hover:border-primary hover:bg-primary/5">
            <span className="text-2xl" aria-hidden>
              {c.emoji}
            </span>
            <span>
              <span className="block text-sm font-bold">{c.label}</span>
              <span className="block text-xs text-muted">{c.description}</span>
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

function catLabel(id: QuestCategoryId) {
  const c = QUEST_CATEGORIES.find((x) => x.id === id);
  return c ? `${c.emoji} ${c.label}` : id;
}

/** In-chat mini card driven entirely by server-authoritative QuestView state. */
export function QuestPanel({ quest, peerName, notice }: { quest: QuestView | null; peerName: string; notice: string | null }) {
  const reduce = useReducedMotion();
  return (
    <div className="px-3 sm:px-6">
      <AnimatePresence>
        {notice && !quest && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mb-2 text-center text-xs text-muted" role="status">
            {notice}
          </motion.p>
        )}
        {quest && (
          <motion.section
            key="quest"
            aria-label="Conversation Quest"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            className="mb-2 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-surface to-accent/10 p-4 shadow-glow"
          >
            <header className="mb-2 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-primary">
                <Sparkles className="h-3.5 w-3.5" aria-hidden /> {catLabel(quest.category)} {quest.round > 0 && <span className="text-muted">· Round {quest.round}</span>}
              </span>
              <button onClick={() => chatClient.questEnd()} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-fg">
                <X className="h-3.5 w-3.5" aria-hidden /> End quest
              </button>
            </header>
            {notice && <p className="mb-2 text-xs text-muted" role="status">{notice}</p>}
            <QuestBody quest={quest} peerName={peerName} />
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function QuestBody({ quest, peerName }: { quest: QuestView; peerName: string }) {
  if (quest.status === 'proposed') {
    return quest.proposedBy === 'me' ? (
      <p className="text-sm text-muted">Waiting for {peerName} to accept your quest invite…</p>
    ) : (
      <div>
        <p className="text-sm font-semibold">{peerName} invited you to a Conversation Quest!</p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={() => chatClient.questRespond(true)}>
            Let's play
          </Button>
          <Button size="sm" variant="ghost" onClick={() => chatClient.questRespond(false)}>
            Not now
          </Button>
        </div>
      </div>
    );
  }
  if (!quest.question) return null;
  if (quest.status === 'revealed' && quest.reveal) return <Reveal quest={quest} peerName={peerName} />;
  return <Answer key={quest.question.id} quest={quest} peerName={peerName} />;
}

function Answer({ quest, peerName }: { quest: QuestView; peerName: string }) {
  const q = quest.question!;
  const [answer, setAnswer] = useState('');
  const [guess, setGuess] = useState('');
  const submit = (a = answer) => {
    if (!a.trim()) return;
    if (q.kind === 'guess' && !guess) return;
    chatClient.questAnswer(q.id, a.trim(), q.kind === 'guess' ? guess : undefined);
  };
  return (
    <div>
      <h3 className="text-[17px] font-bold leading-snug">{q.text}</h3>
      {q.hint && <p className="mt-1 text-xs text-muted">{q.hint}</p>}
      {quest.myAnswered ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
          <Check className="h-4 w-4 text-success" aria-hidden /> Answer locked in. {quest.peerAnswered ? 'Revealing…' : `Waiting for ${peerName}…`}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {q.kind === 'open' && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Input value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={LIMITS.QUEST_ANSWER_MAX} placeholder="Your answer (keep it non-identifying)" aria-label="Your answer" />
              <Button type="submit" disabled={!answer.trim()}>
                Lock in
              </Button>
            </form>
          )}
          {q.kind === 'choice' && (
            <div className="grid grid-cols-2 gap-2">
              {q.options!.map((o) => (
                <Button key={o} variant="outline" className="h-auto min-h-11 whitespace-normal py-2" onClick={() => submit(o)}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          {q.kind === 'guess' && (
            <>
              <OptionGroup label="Your answer" options={q.options!} value={answer} onChange={setAnswer} />
              <OptionGroup label={`Guess ${peerName}'s answer`} options={q.options!} value={guess} onChange={setGuess} />
              <Button size="sm" disabled={!answer || !guess} onClick={() => submit()}>
                Lock in
              </Button>
            </>
          )}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{quest.peerAnswered ? `${peerName} has answered ✓` : `${peerName} is thinking…`}</span>
            <button onClick={() => chatClient.questSkip()} className="inline-flex items-center gap-1 font-semibold hover:text-fg">
              <SkipForward className="h-3.5 w-3.5" aria-hidden /> Skip question
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold text-muted">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(o)} className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', value === o ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:bg-surface-2')}>
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function Reveal({ quest, peerName }: { quest: QuestView; peerName: string }) {
  const r = quest.reveal!;
  const reduce = useReducedMotion();
  const card = (who: string, a: { answer: string; guess?: string }, delay: number, tone: string) => (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, rotateY: 90 }}
      animate={{ opacity: 1, rotateY: 0 }}
      transition={{ delay, duration: 0.45, ease: 'easeOut' }}
      className={cn('rounded-xl p-3', tone)}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide opacity-80">{who}</p>
      <p className="mt-0.5 whitespace-pre-wrap break-anywhere text-sm font-semibold">{a.answer}</p>
      {a.guess && <p className="mt-1 text-xs opacity-80">Guessed: {a.guess}</p>}
    </motion.div>
  );
  return (
    <div>
      <h3 className="text-[15px] font-bold leading-snug">{quest.question!.text}</h3>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" style={{ perspective: 800 }}>
        {card('You', r.mine, 0, 'bg-primary/15')}
        {card(peerName, r.peer, 0.15, 'bg-coral/15')}
      </div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-2 text-center text-sm font-semibold" role="status">
        {r.sameChoice === true && '✨ Same pick! Great minds.'}
        {r.sameChoice === false && 'Different picks — tell each other why!'}
        {r.myGuessCorrect !== undefined && `${r.myGuessCorrect ? 'You guessed right! 🎯' : 'Your guess missed.'} ${r.peerGuessCorrect ? `${peerName} read you perfectly.` : `${peerName} guessed wrong.`}`}
      </motion.p>
      <div className="mt-3 flex justify-center gap-2">
        <Button size="sm" onClick={() => chatClient.questNext()}>
          Next question
        </Button>
        <Button size="sm" variant="ghost" onClick={() => chatClient.questEnd()}>
          Back to chat
        </Button>
      </div>
    </div>
  );
}
