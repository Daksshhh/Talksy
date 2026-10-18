import { RefreshCw } from 'lucide-react';
import { AVATAR_STYLES, type AvatarStyle } from '@orbit/shared';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { randomSeed } from '@/lib/avatar';
import { cn } from '@/lib/utils';

export function AvatarPicker({ value, onChange }: { value: { style: AvatarStyle; seed: string }; onChange: (v: { style: AvatarStyle; seed: string }) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Avatar</legend>
      <div className="flex items-center gap-4">
        <Avatar seed={value.seed} style={value.style} size={72} label="Selected avatar preview" />
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar style">
          {AVATAR_STYLES.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={value.style === s}
              aria-label={`${s} style`}
              onClick={() => onChange({ ...value, style: s })}
              className={cn('rounded-full p-0.5 ring-2 transition', value.style === s ? 'ring-primary' : 'ring-transparent hover:ring-border')}
            >
              <Avatar seed={value.seed} style={s} size={40} />
            </button>
          ))}
        </div>
      </div>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => onChange({ ...value, seed: randomSeed() })} leftIcon={<RefreshCw className="h-4 w-4" />}>
        Shuffle design
      </Button>
    </fieldset>
  );
}
