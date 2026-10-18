import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { toast } from '@/stores/uiStore';
import { qk } from './queries';

/**
 * One authorized Realtime channel per signed-in user. Postgres Changes are filtered
 * by RLS, so only rows this user may read are delivered. We use them to invalidate
 * cached queries (never to invent counts) and show toasts for new notifications.
 */
export function useRealtimeSync(userId: string | null) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (!userId) return;
    const inval = (...keys: ReadonlyArray<readonly unknown[]>) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
    const ch = supabase
      .channel(`user-sync:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (p) => {
        const n = p.new as { type: string; title: string; body: string; data: Record<string, unknown> };
        inval(qk.notifications, qk.unread);
        if (n.type === 'friend_request') {
          inval(qk.requests);
          toast({ title: n.title, body: n.body, action: { label: 'View', onClick: () => navigate('/app/friends?tab=incoming') } });
        } else if (n.type === 'friend_accepted') {
          inval(qk.friends, qk.inbox, qk.requests, qk.friendPresence);
          toast({ title: n.title, body: n.body, tone: 'success', action: n.data?.conversationId ? { label: 'Say hi', onClick: () => navigate(`/app/inbox/${n.data.conversationId}`) } : undefined });
        } else if (n.type === 'dm') {
          // Don't toast if the conversation is currently open.
          if (!window.location.pathname.endsWith(String(n.data?.conversationId ?? '__'))) toast({ title: n.title, body: n.body, action: { label: 'Open', onClick: () => navigate(`/app/inbox/${n.data?.conversationId}`) } });
        } else if (n.type === 'safety') {
          inval(qk.me);
          toast({ title: n.title, body: n.body, tone: 'error' });
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => inval(qk.notifications, qk.unread))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () => inval(qk.requests, qk.unread, qk.history))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => inval(qk.friends, qk.inbox, qk.friendPresence, qk.me))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => inval(qk.inbox, qk.unread))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc, navigate]);
}
