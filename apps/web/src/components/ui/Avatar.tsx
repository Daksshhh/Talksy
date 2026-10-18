import { memo } from 'react';
import type { AvatarStyle } from '@orbit/shared';
import { avatarParams } from '@/lib/avatar';
import { cn } from '@/lib/utils';

/** Generated "planet" avatar — safe by design (no user uploads). */
export const Avatar = memo(function Avatar({
  seed,
  style = 'orbit',
  size = 40,
  className,
  status,
  label,
}: {
  seed: string;
  style?: AvatarStyle | string;
  size?: number;
  className?: string;
  status?: 'online' | 'in_chat' | 'searching' | 'offline' | 'hidden' | 'unknown';
  label?: string;
}) {
  const p = avatarParams(seed || 'orbit', (style as AvatarStyle) ?? 'orbit');
  const gid = `av-${seed}-${style}`.replace(/[^a-z0-9-]/gi, '');
  const mx = 32 + Math.cos(p.moonAngle) * 22;
  const my = 32 + Math.sin(p.moonAngle) * 10;
  const dot =
    status === 'online' || status === 'searching'
      ? 'bg-success'
      : status === 'in_chat'
        ? 'bg-warning'
        : status === 'offline'
          ? 'bg-muted'
          : null;
  return (
    <span className={cn('relative inline-flex shrink-0', className)} style={{ width: size, height: size }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 64 64" width={size} height={size} className="rounded-full">
        <defs>
          <linearGradient id={gid} gradientTransform={`rotate(${p.angle} .5 .5)`}>
            <stop offset="0" stopColor={p.c1} />
            <stop offset="1" stopColor={p.c2} />
          </linearGradient>
        </defs>
        <rect width="64" height="64" fill={p.dark} />
        <circle cx="32" cy="32" r={p.planetR} fill={`url(#${gid})`} />
        <ellipse cx="32" cy="32" rx="26" ry="8" fill="none" stroke={p.c1} strokeOpacity=".55" strokeWidth="2.5" transform={`rotate(${p.ringTilt} 32 32)`} />
        <circle cx={mx} cy={my} r="4" fill="#FF7A6B" />
      </svg>
      {dot && <span className={cn('absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-surface', dot)} />}
    </span>
  );
});
