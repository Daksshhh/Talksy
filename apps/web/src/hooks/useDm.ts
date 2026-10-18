import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { LIMITS } from '@orbit/shared';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/api';
import { uuid } from '@/lib/utils';
import { qk } from './queries';

export interface DmMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  body: string;
  created_at: string;
  status?: 'sending' | 'sent' | 'failed';
  error?: string;
}
type Pages = InfiniteData<DmMessage[], string | null>;

const COLS = 'id,conversation_id,sender_id,client_id,body,created_at';

/** Persistent DMs: cursor pagination + Realtime inserts + optimistic sends with idempotent retries. */
export function useDmThread(conversationId: string, myId: string) {
  const qc = useQueryClient();
  const key = qk.dm(conversationId);

  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let q = supabase.from('direct_messages').select(COLS).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(LIMITS.DM_PAGE_SIZE);
      if (pageParam) q = q.lt('created_at', pageParam);
      const { data, error } = await q;
      if (error) throw error;
      return (data as DmMessage[]).map((m) => ({ ...m, status: 'sent' as const }));
    },
    getNextPageParam: (last) => (last.length === LIMITS.DM_PAGE_SIZE ? last[last.length - 1].created_at : null),
  });

  const upsert = useCallback(
    (msg: DmMessage) => {
      qc.setQueryData<Pages>(key, (old) => {
        if (!old) return { pages: [[msg]], pageParams: [null] };
        const exists = old.pages.some((p) => p.some((m) => m.id === msg.id || (m.client_id === msg.client_id && m.sender_id === msg.sender_id)));
        if (exists) {
          return { ...old, pages: old.pages.map((p) => p.map((m) => (m.client_id === msg.client_id && m.sender_id === msg.sender_id ? { ...msg } : m))) };
        }
        const [first, ...rest] = old.pages;
        return { ...old, pages: [[msg, ...(first ?? [])], ...rest] };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc, conversationId],
  );

  // Realtime: new messages + peer typing (private broadcast channel, RLS-authorized).
  const [peerTyping, setPeerTyping] = useState(false);
  const typingChannel = useRef<RealtimeChannel | null>(null);
  useEffect(() => {
    const changes = supabase
      .channel(`dm-changes:${conversationId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` }, (p) => {
        const m = p.new as DmMessage;
        upsert({ ...m, status: 'sent' });
        if (m.sender_id !== myId) setPeerTyping(false);
      })
      .subscribe();
    let typingTimer: ReturnType<typeof setTimeout> | undefined;
    const typing = supabase
      .channel(`dm:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'typing' }, (p) => {
        const isTyping = !!(p.payload as { typing?: boolean }).typing;
        setPeerTyping(isTyping);
        clearTimeout(typingTimer);
        if (isTyping) typingTimer = setTimeout(() => setPeerTyping(false), 6000);
      })
      .subscribe();
    typingChannel.current = typing;
    return () => {
      clearTimeout(typingTimer);
      supabase.removeChannel(changes);
      supabase.removeChannel(typing);
      typingChannel.current = null;
    };
  }, [conversationId, myId, upsert]);

  const sendTyping = useCallback((typing: boolean) => {
    void typingChannel.current?.send({ type: 'broadcast', event: 'typing', payload: { typing } });
  }, []);

  const send = useCallback(
    async (body: string, clientId: string = uuid()) => {
      const optimistic: DmMessage = { id: `local-${clientId}`, conversation_id: conversationId, sender_id: myId, client_id: clientId, body, created_at: new Date().toISOString(), status: 'sending' };
      upsert(optimistic);
      const { data, error } = await supabase.rpc('send_dm', { p_conversation: conversationId, p_body: body, p_client_id: clientId });
      if (error) {
        upsert({ ...optimistic, status: 'failed', error: errorMessage(error) });
        return false;
      }
      upsert({ ...(data as DmMessage), status: 'sent' });
      qc.invalidateQueries({ queryKey: qk.inbox });
      return true;
    },
    [conversationId, myId, upsert, qc],
  );

  const markRead = useCallback(async () => {
    await supabase.rpc('mark_conversation_read', { p_conversation: conversationId });
    qc.invalidateQueries({ queryKey: qk.unread });
    qc.invalidateQueries({ queryKey: qk.inbox });
  }, [conversationId, qc]);

  const messages = (query.data?.pages ?? []).flat().slice().reverse();
  return { ...query, messages, send, markRead, peerTyping, sendTyping };
}
