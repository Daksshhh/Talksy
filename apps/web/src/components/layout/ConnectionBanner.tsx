import { WifiOff, Loader2 } from 'lucide-react';
import { useChat } from '@/services/chatClient';

export function ConnectionBanner() {
  const conn = useChat((s) => s.conn);
  const error = useChat((s) => s.error);
  if (error) return <div role="alert" className="bg-danger/15 px-4 py-2 text-center text-sm font-medium text-danger">{error}</div>;
  if (conn === 'online') return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-1.5 text-sm font-medium text-warning">
      {conn === 'offline' ? <WifiOff className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
      {conn === 'offline' ? "You're offline. We'll reconnect automatically." : 'Reconnecting…'}
    </div>
  );
}
