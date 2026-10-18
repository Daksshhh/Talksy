import { segmentLinks } from '@orbit/shared';
import { Link2Off } from 'lucide-react';

/**
 * Renders user text safely: React escapes HTML, and URLs are shown as
 * NON-clickable, visually flagged spans (stranger-chat link safety).
 */
export function SafeText({ text }: { text: string }) {
  const parts = segmentLinks(text);
  return (
    <>
      {parts.map((p, i) =>
        p.type === 'link' ? (
          <span key={i} className="inline-flex items-baseline gap-1 rounded bg-warning/15 px-1 text-warning" title="Links from strangers are not clickable. Be careful.">
            <Link2Off className="h-3 w-3 self-center" aria-hidden />
            <span className="break-anywhere">{p.value}</span>
            <span className="sr-only">(unverified link, not clickable)</span>
          </span>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}
