import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal: focus trap, Escape to close, scroll lock, returns focus.
 * Renders as a centered dialog on ≥sm screens and a bottom sheet on phones.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  dismissible = true,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const reduce = useReducedMotion();
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);

  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;


  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
      el?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissibleRef.current) {
        e.stopPropagation();
        onCloseRef.current();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  const widths = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-2xl' };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismissible ? onClose : undefined}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descId : undefined}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 40 }}
            transition={{ type: 'spring', damping: 30, stiffness: 360 }}
            className={cn(
              'relative z-10 max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl border border-border bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl scrollbar-thin sm:rounded-3xl sm:p-6',
              widths[size],
              className,
            )}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border sm:hidden" aria-hidden />
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-lg font-bold">
                  {title}
                </h2>
                {description && (
                  <div id={descId} className="mt-1 text-sm text-muted">
                    {description}
                  </div>
                )}
              </div>
              {dismissible && (
                <button onClick={onClose} className="-mr-1 -mt-1 grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label="Close dialog">
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
