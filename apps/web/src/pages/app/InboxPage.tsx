import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Flag, Inbox, MoreVertical, Trash2, UserRound } from 'lucide-react';
import { LIMITS, type AvatarStyle } from '@orbit/shared';
import { useInbox, useInvalidateSocial, type InboxItem } from '@/hooks/queries';
import { useDmThread } from '@/hooks/useDm';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/uiStore';
import { api, errorMessage } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/ui/Avatar';
import { CountBadge, EmptyState, ErrorState, Skeleton, Spinner } from '@/components/ui/Feedback';
import { Menu } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { MessageList, type ListMessage } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';
import { ReportDialog } from '@/components/chat/ReportDialog';
import { cn, timeAgo } from '@/lib/utils';

export default function InboxPage() {
  const { conversationId } = useParams();
  const inbox = useInbox();
  return (
    <div className="flex h-full min-h-0">
      <div className={cn('w-full shrink-0 overflow-y-auto border-r border-border/60 scrollbar-thin md:w-80', conversationId && 'hidden md:block')}>
        <h1 className="px-4 pb-2 pt-5 text-2xl font-extrabold">Messages</h1>
        <ConversationList inbox={inbox} activeId={conversationId} />
      </div>
      <div className={cn('min-w-0 flex-1', !conversationId && 'hidden md:flex')}>
        {conversationId ? (
          <Thread key={conversationId} conversationId={conversationId} item={inbox.data?.find((c) => c.conversationId === conversationId)} loadingMeta={inbox.isLoading} />
        ) : (
          <EmptyState className="m-auto" icon={<Inbox className="h-6 w-6" />} title="Select a conversation" body="Private messages with your friends appear here." />
        )}
      </div>
    </div>
  );
}

function ConversationList({ inbox, activeId }: { inbox: ReturnType<typeof useInbox>; activeId?: string }) {
  if (inbox.isLoading) return <div className="space-y-2 p-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (inbox.isError) return <ErrorState message={errorMessage(inbox.error)} onRetry={() => inbox.refetch()} />;
  if (!inbox.data?.length) return <EmptyState icon={<Inbox className="h-6 w-6" />} title="No conversations yet" body="Accept a friend request to start a private conversation." />;
  return (
    <ul className="px-2 pb-6">
      {inbox.data.map((c) => (
        <li key={c.conversationId}>
          <Link to={`/app/inbox/${c.conversationId}`} aria-current={activeId === c.conversationId ? 'page' : undefined} className={cn('flex items-center gap-3 rounded-2xl p-3 hover:bg-surface-2', activeId === c.conversationId && 'bg-surface-2')}>
            <Avatar seed={c.peerAvatarSeed ?? 'x'} style={(c.peerAvatarStyle ?? 'orbit') as AvatarStyle} size={44} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn('truncate', c.unread ? 'font-extrabold' : 'font-semibold')}>{c.peerName ?? 'Deleted user'}</p>
                {c.lastMessage && <span className="shrink-0 text-[11px] text-muted">{timeAgo(c.lastMessage.createdAt)}</span>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className={cn('truncate text-sm', c.unread ? 'text-fg' : 'text-muted')}>
                  {c.lastMessage ? `${c.lastMessage.fromMe ? 'You: ' : ''}${c.lastMessage.body}` : 'Say hi 👋'}
                </p>
                <CountBadge count={c.unread} />
              </div>
              {(!c.isFriend || c.isBlocked) && <p className="text-[11px] text-muted">{c.isBlocked ? 'Blocked' : 'Read-only'}</p>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Thread({ conversationId, item, loadingMeta }: { conversationId: string; item?: InboxItem; loadingMeta: boolean }) {
  const myId = useAuth((s) => s.userId)!;
  const navigate = useNavigate();
  const invalidate = useInvalidateSocial();
  const t = useDmThread(conversationId, myId);
  const [report, setReport] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [peerReadAt, setPeerReadAt] = useState<string | null>(item?.peerLastReadAt ?? null);
  const canSend = !!item && item.isFriend && !item.isBlocked;
  const { markRead } = t;

  useEffect(() => setPeerReadAt(item?.peerLastReadAt ?? null), [item?.peerLastReadAt]);

  // Mark read on open and when new peer messages arrive while visible.
  const lastPeer = [...t.messages].reverse().find((m) => m.sender_id !== myId)?.id;
  useEffect(() => {
    if (document.visibilityState === 'visible') void markRead();
  }, [lastPeer, markRead]);

  // Live read receipts.
  useEffect(() => {
    if (!item) return;
    const ch = supabase
      .channel(`dm-read:${conversationId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'direct_conversation_members', filter: `conversation_id=eq.${conversationId}` }, (p) => {
        const row = p.new as { user_id: string; last_read_at: string };
        if (row.user_id !== myId) setPeerReadAt(row.last_read_at);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [conversationId, myId, item]);

  const list: ListMessage[] = useMemo(
    () =>
      t.messages.map((m) => ({
        key: m.client_id,
        from: m.sender_id === myId ? 'me' : 'peer',
        text: m.body,
        ts: new Date(m.created_at).getTime(),
        status: m.status ?? 'sent',
        error: m.error,
        seen: m.sender_id === myId && !!peerReadAt && new Date(peerReadAt) >= new Date(m.created_at),
      })),
    [t.messages, myId, peerReadAt],
  );

  if (!item && !loadingMeta) return <ErrorState className="m-auto" title="Conversation not found" message="It may have been removed, or you don't have access." />;

  const name = item?.peerName ?? 'Friend';
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <header className="glass flex items-center gap-3 border-b border-border/60 px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] md:pt-2.5">
        <button onClick={() => navigate('/app/inbox')} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-surface-2 md:hidden" aria-label="Back to conversations">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar seed={item?.peerAvatarSeed ?? 'x'} style={(item?.peerAvatarStyle ?? 'orbit') as AvatarStyle} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{name}</p>
          <p className="text-xs text-muted" aria-live="polite">{t.peerTyping ? 'typing…' : canSend ? 'Friend' : item?.isBlocked ? 'Blocked' : 'Read-only'}</p>
        </div>
        <Menu
          label="Conversation actions"
          trigger={(p) => (
            <button {...p} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label="Conversation actions">
              <MoreVertical className="h-5 w-5" />
            </button>
          )}
          items={[
            ...(item?.isFriend ? [{ label: 'View profile', icon: <UserRound className="h-4 w-4" />, onSelect: () => navigate(`/app/u/${item.peerId}`) }] : []),
            { label: 'Delete my copy', icon: <Trash2 className="h-4 w-4" />, onSelect: () => setConfirmClear(true) },
          ]}
        />
      </header>
      {t.isLoading ? (
        <div className="grid flex-1 place-items-center">
          <Spinner />
        </div>
      ) : t.isError ? (
        <ErrorState className="flex-1" message={errorMessage(t.error)} onRetry={() => t.refetch()} />
      ) : (
        <MessageList
          messages={list}
          peerName={name}
          typing={t.peerTyping}
          onReachTop={() => t.hasNextPage && !t.isFetchingNextPage && t.fetchNextPage()}
          onRetry={(key) => {
            const m = t.messages.find((x) => x.client_id === key);
            if (m) void t.send(m.body, m.client_id);
          }}
          header={
            <div className="mb-3 text-center text-xs text-muted">
              {t.isFetchingNextPage ? <Spinner /> : t.hasNextPage ? 'Scroll up for older messages' : list.length ? 'Beginning of your conversation' : `Say hi to ${name}! 👋`}
            </div>
          }
        />
      )}
      {list.some((m) => m.from === 'peer') && (
        <div className="px-4 pb-1 text-right">
          <button className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-danger" onClick={() => setReport([...t.messages].reverse().find((m) => m.sender_id !== myId)?.id ?? null)}>
            <Flag className="h-3 w-3" aria-hidden /> Report last message
          </button>
        </div>
      )}
      {canSend ? (
        <Composer draftKey={`orbit.dm.${conversationId}`} maxChars={LIMITS.DM_MAX_CHARS} onSend={(text) => t.send(text)} onTyping={t.sendTyping} />
      ) : (
        <p className="border-t border-border/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-center text-sm text-muted">
          {item?.isBlocked ? 'You can no longer message this user.' : 'You are no longer friends — this conversation is read-only.'}
        </p>
      )}
      <ReportDialog
        open={!!report}
        onClose={() => setReport(null)}
        subject="this message"
        evidenceNote="Only the reported message is shared with moderators — never the rest of your conversation."
        onSubmit={async (r) => {
          await api('/api/reports', { method: 'POST', body: { ...r, context: 'dm', messageId: report } });
          toast({ title: 'Report sent', tone: 'success' });
          if (r.alsoBlock) invalidate();
        }}
      />
      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} size="sm" title="Delete your copy?" description="Messages up to now will be hidden for you only. Your friend keeps their copy.">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              const { error } = await supabase.rpc('clear_conversation', { p_conversation: conversationId });
              setConfirmClear(false);
              if (error) toast({ title: 'Could not delete', body: errorMessage(error), tone: 'error' });
              else {
                toast({ title: 'Conversation cleared', tone: 'success' });
                t.refetch();
                invalidate();
              }
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
