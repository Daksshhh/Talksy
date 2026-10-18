import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function newClientId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function uuid(): string {
  return crypto.randomUUID();
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }) : null;

export function timeAgo(input: string | number | Date): string {
  const d = new Date(input).getTime();
  const diff = (d - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (!rtf) return new Date(d).toLocaleString();
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(d).toLocaleDateString();
}

export function clockTime(input: string | number | Date): string {
  return new Date(input).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function sameDay(a: number | string, b: number | string): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}
