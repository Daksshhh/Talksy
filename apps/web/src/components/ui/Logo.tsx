import { env } from '@/lib/env';
import { useId } from 'react';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  const gradientId = `talksy-logo-${useId().replace(/:/g, '')}`;

  return (
    <svg viewBox="0 0 64 64" className={cn('h-8 w-8', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14E0C4" />
          <stop offset="1" stopColor="#3D7BFF" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="32" rx="26" ry="11" fill="none" stroke={`url(#${gradientId})`} strokeWidth="4.5" transform="rotate(-28 32 32)" />
      <circle cx="32" cy="32" r="11" fill={`url(#${gradientId})`} />
      <circle cx="54" cy="19" r="5" fill="#FF7A6B" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-extrabold tracking-tight', className)}>
      <LogoMark />
      <span className="text-lg">{env.appName}</span>
    </span>
  );
}
