import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useUi } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:items-end sm:p-5">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border border-border bg-surface p-3.5 shadow-2xl"
          >
            {t.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" /> : t.tone === 'error' ? <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" /> : <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.body && <p className="mt-0.5 text-sm text-muted break-anywhere">{t.body}</p>}
              {t.action && (
                <button onClick={() => { t.action!.onClick(); dismiss(t.id); }} className={cn('mt-2 text-sm font-bold text-primary hover:underline')}>
                  {t.action.label}
                </button>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Dismiss notification">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
