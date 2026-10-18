import { useState } from 'react';
import { X } from 'lucide-react';
import { LIMITS } from '@orbit/shared';
import { Input } from '@/components/ui/Field';

const SUGGESTED = ['Music', 'Gaming', 'Movies', 'Travel', 'Books', 'Tech', 'Art', 'Sports', 'Food', 'Anime', 'Languages', 'Fitness'];

export function InterestsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().slice(0, LIMITS.INTEREST_MAX_CHARS);
    if (!t || value.length >= LIMITS.INTERESTS_MAX || value.some((v) => v.toLowerCase() === t.toLowerCase())) return;
    onChange([...value, t]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      <label htmlFor="interest-input" className="block text-sm font-semibold">
        Interests <span className="font-normal text-muted">(optional, up to {LIMITS.INTERESTS_MAX})</span>
      </label>
      <div className="flex flex-wrap gap-2">
        {value.map((i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/15 py-1 pl-3 pr-1.5 text-sm font-semibold text-primary">
            {i}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== i))} className="rounded-full p-0.5 hover:bg-primary/20" aria-label={`Remove ${i}`}>
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
      </div>
      <Input
        id="interest-input"
        value={draft}
        placeholder="Type and press Enter"
        maxLength={LIMITS.INTEREST_MAX_CHARS}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(draft);
          }
        }}
        disabled={value.length >= LIMITS.INTERESTS_MAX}
      />
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.filter((s) => !value.includes(s)).slice(0, 8).map((s) => (
          <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-primary hover:text-primary">
            + {s}
          </button>
        ))}
      </div>
    </div>
  );
}
