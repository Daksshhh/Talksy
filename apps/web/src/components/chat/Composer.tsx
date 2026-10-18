import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SendHorizonal } from 'lucide-react';
import { charCount } from '@orbit/shared';
import { cn } from '@/lib/utils';

/**
 * Message composer: Enter sends, Shift+Enter inserts a newline, IME-safe,
 * auto-growing, character counter, debounced typing signal, draft persistence.
 */
export function Composer({
  onSend,
  onTyping,
  disabled,
  placeholder = 'Type a message…',
  maxChars,
  draftKey,
}: {
  onSend: (text: string) => boolean | Promise<boolean> | void;
  onTyping?: (typing: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  maxChars: number;
  draftKey?: string;
}) {
  const [text, setText] = useState(() => (draftKey ? sessionStorage.getItem(draftKey) ?? '' : ''));
  const ref = useRef<HTMLTextAreaElement>(null);
  const typingOn = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  const count = charCount(text);
  const over = count > maxChars;

  useEffect(() => {
    setText(draftKey ? sessionStorage.getItem(draftKey) ?? '' : '');
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey) return;
    if (text) sessionStorage.setItem(draftKey, text);
    else sessionStorage.removeItem(draftKey);
  }, [text, draftKey]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(
    () => () => {
      clearTimeout(typingTimer.current);
      if (typingOn.current) onTyping?.(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (typingOn.current) {
      typingOn.current = false;
      onTyping?.(false);
    }
  };

  const change = (v: string) => {
    setText(v);
    if (!onTyping) return;
    if (!v.trim()) return stopTyping();
    if (!typingOn.current) {
      typingOn.current = true;
      onTyping(true);
    }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 3000);
  };

  const submit = async () => {
    const t = text.trim();
    if (!t || over || disabled) return;
    const ok = await onSend(t);
    if (ok !== false) {
      setText('');
      stopTyping();
    }
    ref.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="border-t border-border/60 bg-surface/80 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <div className={cn('flex items-end gap-2 rounded-2xl border bg-surface-2/60 p-1.5 pl-3.5 transition-colors focus-within:border-primary', over ? 'border-danger' : 'border-border')}>
        <label htmlFor="composer" className="sr-only">
          Message
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKey}
          onBlur={stopTyping}
          enterKeyHint="send"
          className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[16px] leading-6 text-fg placeholder:text-muted focus:outline-none disabled:cursor-not-allowed sm:text-[15px]"
          aria-describedby="composer-count"
        />
        <button
          onClick={() => void submit()}
          disabled={disabled || !text.trim() || over}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gradient text-primary-fg transition active:scale-95 disabled:opacity-40"
          aria-label="Send message"
        >
          <SendHorizonal className="h-5 w-5" />
        </button>
      </div>
      <div className="mt-1 flex justify-between px-1 text-[11px] text-muted">
        <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
        <span id="composer-count" className={cn('ml-auto', over ? 'font-bold text-danger' : count > maxChars * 0.8 ? 'text-warning' : 'invisible')} aria-live="polite">
          {count}/{maxChars}
        </span>
      </div>
    </div>
  );
}
