import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  badge?: ReactNode;
}

/** WAI-ARIA tabs with roving focus. Panel content is rendered by the parent. */
export function Tabs<T extends string>({ tabs, value, onChange, label, className }: { tabs: TabDef<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    let n = i;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    else return;
    e.preventDefault();
    onChange(tabs[n].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[n]?.focus();
  };
  return (
    <div ref={ref} role="tablist" aria-label={label} onKeyDown={onKey} className={cn('flex gap-1 overflow-x-auto rounded-2xl bg-surface-2/70 p-1 scrollbar-thin', className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors', active ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg')}
          >
            {t.label}
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}
