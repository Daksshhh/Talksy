import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, RotateCw, AlertCircle, Check } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn, clockTime, sameDay } from '@/lib/utils';
import { SafeText } from './SafeText';

export interface ListMessage {
  key: string;
  from: 'me' | 'peer' | 'system';
  text: string;
  ts: number;
  status?: 'sending' | 'sent' | 'failed';
  error?: string;
  seen?: boolean;
}

const Bubble = memo(function Bubble({ m, onRetry, peerName }: { m: ListMessage; onRetry?: (key: string) => void; peerName: string }) {
  const reduce = useReducedMotion();
  if (m.from === 'system')
    return (
      <div className="my-2 text-center text-xs text-muted" role="note">
        {m.text}
      </div>
    );
  const mine = m.from === 'me';
  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className={cn('flex w-full', mine ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] sm:max-w-[70%]')}>
        <div
          className={cn(
            'whitespace-pre-wrap break-anywhere rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed',
            mine ? 'rounded-br-md bg-brand-gradient text-primary-fg' : 'rounded-bl-md bg-surface-2 text-fg',
            m.status === 'failed' && 'opacity-70 ring-1 ring-danger',
          )}
        >
          <span className="sr-only">{mine ? 'You' : peerName}: </span>
          <SafeText text={m.text} />
        </div>
        <div className={cn('mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted', mine ? 'justify-end' : 'justify-start')}>
          <time dateTime={new Date(m.ts).toISOString()}>{clockTime(m.ts)}</time>
          {mine && m.status === 'sending' && <span aria-label="Sending">· sending…</span>}
          {mine && m.status === 'sent' && (m.seen ? <span>· Seen</span> : <Check className="h-3 w-3" aria-label="Delivered" />)}
          {mine && m.status === 'failed' && (
            <span className="flex items-center gap-1 text-danger">
              <AlertCircle className="h-3 w-3" aria-hidden /> {m.error ?? 'Failed'}
              {onRetry && (
                <button onClick={() => onRetry(m.key)} className="inline-flex items-center gap-0.5 font-semibold underline">
                  <RotateCw className="h-3 w-3" aria-hidden /> Retry
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
});

/**
 * Chat transcript with "stick to bottom" behaviour: auto-scrolls only when the
 * reader is already near the bottom; otherwise shows a "new messages" pill.
 */
export function MessageList({
  messages,
  onRetry,
  peerName,
  typing,
  header,
  footer,
  onReachTop,
  className,
}: {
  messages: ListMessage[];
  onRetry?: (key: string) => void;
  peerName: string;
  typing?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  onReachTop?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const lastKey = messages[messages.length - 1]?.key;
  const firstKey = messages[0]?.key;
  const prevFirst = useRef(firstKey);
  const prevHeight = useRef(0);
  const [announce, setAnnounce] = useState('');

  const scrollToBottom = useCallback((smooth = true) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    setUnseen(0);
  }, []);

  const onScroll = () => {
    const el = ref.current!;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setUnseen(0);
    if (el.scrollTop < 40) onReachTop?.();
  };

  // Preserve position when older messages are prepended (pagination).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prevFirst.current && firstKey !== prevFirst.current && prevHeight.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    }
    prevFirst.current = firstKey;
    prevHeight.current = el.scrollHeight;
  }, [firstKey]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;
    if (last.from === 'peer') setAnnounce(`${peerName}: ${last.text.slice(0, 140)}`);
    if (atBottom.current || last.from === 'me') requestAnimationFrame(() => scrollToBottom(last.from !== 'me'));
    else setUnseen((n) => n + 1);
    prevHeight.current = ref.current?.scrollHeight ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  useEffect(() => {
    if (typing && atBottom.current) requestAnimationFrame(() => scrollToBottom());
  }, [typing, scrollToBottom]);

  useEffect(() => scrollToBottom(false), [scrollToBottom]);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const keepComposerVisible = () => {
      if (atBottom.current) requestAnimationFrame(() => scrollToBottom(false));
    };
    viewport.addEventListener('resize', keepComposerVisible);
    return () => viewport.removeEventListener('resize', keepComposerVisible);
  }, [scrollToBottom]);

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain px-3 py-4 scrollbar-thin sm:px-6" role="log" aria-label="Conversation" aria-live="off">
        {header}
        <div className="space-y-1.5">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            return (
              <div key={m.key}>
                {(!prev || !sameDay(prev.ts, m.ts)) && <div className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">{new Date(m.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>}
                <Bubble m={m} onRetry={onRetry} peerName={peerName} />
              </div>
            );
          })}
        </div>
        {typing && (
          <div className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted" aria-live="polite">
            <span className="inline-flex gap-1 rounded-2xl bg-surface-2 px-3 py-2.5">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-1.5 w-1.5 rounded-full bg-muted animate-bounce-dot" style={{ animationDelay: `${d * 0.15}s` }} />
              ))}
            </span>
            <span>{peerName} is typing…</span>
          </div>
        )}
        {footer}
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
      {unseen > 0 && (
        <button onClick={() => scrollToBottom()} className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-fg shadow-glow">
          <ArrowDown className="h-3.5 w-3.5" aria-hidden /> {unseen} new message{unseen > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}
