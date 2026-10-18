/**
 * Structured, privacy-conscious logging. Never log message bodies, tokens, emails
 * or IP addresses. User ids are truncated to a short prefix for correlation.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

export const shortId = (id: string | null | undefined): string | undefined => (id ? id.slice(0, 8) : undefined);

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
