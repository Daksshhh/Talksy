import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Check, MessageSquare, MoreHorizontal, Search, UserMinus, UserRound, Users, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useFriendPresence, useFriendRequests, useFriends, useInvalidateSocial } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/stores/uiStore';
import { Tabs } from '@/components/ui/Tabs';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Menu } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Dialog';
import { Badge, CountBadge, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { timeAgo } from '@/lib/utils';
import type { PresenceStatus } from '@orbit/shared';

type Tab = 'all' | 'online' | 'incoming' | 'sent';
const PRESENCE_LABEL: Record<PresenceStatus, string> = { online: 'Online', in_chat: 'In a chat', searching: 'Searching', offline: 'Offline', hidden: 'Status hidden', unknown: 'Unknown' };

export default function FriendsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'all';
  const setTab = (t: Tab) => setParams({ tab: t }, { replace: true });
  const [q, setQ] = useState('');
  const friends = useFriends();
  const requests = useFriendRequests();
  const presence = useFriendPresence();
  const invalidate = useInvalidateSocial();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'block'; userId: string; name: string } | null>(null);

  const incoming = (requests.data ?? []).filter((r) => r.direction === 'incoming');
  const sent = (requests.data ?? []).filter((r) => r.direction === 'outgoing');
  const isOnline = (id: string) => ['online', 'in_chat', 'searching'].includes(presence.data?.[id] ?? '');
  const list = useMemo(() => {
    const base = (friends.data ?? []).filter((f) => f.displayName.toLowerCase().includes(q.trim().toLowerCase()));
    return tab === 'online' ? base.filter((f) => isOnline(f.userId)) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends.data, q, tab, presence.data]);

  const act = useMutation({
    mutationFn: ({ path, method }: { path: string; method: 'POST' | 'DELETE'; ok: string }) => api(path, { method, body: method === 'POST' ? {} : undefined }),
    onSuccess: (_d, v) => {
      toast({ title: v.ok, tone: 'success' });
      invalidate();
    },
    onError: (e) => toast({ title: 'Action failed', body: errorMessage(e), tone: 'error' }),
  });

  const doConfirm = async () => {
    if (!confirm) return;
    if (confirm.kind === 'remove') await act.mutateAsync({ path: `/api/friends/${confirm.userId}`, method: 'DELETE', ok: `Removed ${confirm.name}` }).catch(() => undefined);
    else
      await api('/api/blocks', { method: 'POST', body: { userId: confirm.userId } })
        .then(() => {
          toast({ title: `Blocked ${confirm.name}`, tone: 'success' });
          invalidate();
        })
        .catch((e) => toast({ title: 'Could not block', body: errorMessage(e), tone: 'error' }));
    setConfirm(null);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-extrabold">Friends</h1>
      <Tabs<Tab>
        className="mt-4"
        label="Friend lists"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'all', label: 'All', badge: friends.data ? <span className="text-xs text-muted">{friends.data.length}</span> : null },
          { id: 'online', label: 'Online' },
          { id: 'incoming', label: 'Requests', badge: <CountBadge count={incoming.length} /> },
          { id: 'sent', label: 'Sent' },
        ]}
      />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
        {(tab === 'all' || tab === 'online') && (
          <>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your friends" className="pl-9" aria-label="Search your friends" />
            </div>
            {friends.isLoading ? (
              <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
            ) : friends.isError ? (
              <ErrorState message={errorMessage(friends.error)} onRetry={() => friends.refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<Users className="h-6 w-6" />}
                title={q ? 'No friends match your search' : tab === 'online' ? 'No friends online right now' : 'Your friends list is empty.'}
                body={q ? undefined : 'Meet someone through random chat and send a friend request.'}
                action={!q && <Button onClick={() => navigate('/app/chat')}>Start a random chat</Button>}
              />
            ) : (
              <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface">
                {list.map((f) => {
                  const p = presence.data?.[f.userId] ?? 'unknown';
                  return (
                    <li key={f.userId} className="flex items-center gap-3 p-3">
                      <Avatar seed={f.avatarSeed} style={f.avatarStyle} size={44} status={p} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{f.displayName}</p>
                        <p className="text-xs text-muted">
                          {PRESENCE_LABEL[p]} · friends {timeAgo(f.since)}
                        </p>
                      </div>
                      {f.conversationId && (
                        <Link to={`/app/inbox/${f.conversationId}`} className="grid h-10 w-10 place-items-center rounded-xl text-primary hover:bg-primary/10" aria-label={`Message ${f.displayName}`}>
                          <MessageSquare className="h-5 w-5" />
                        </Link>
                      )}
                      <Menu
                        label={`Actions for ${f.displayName}`}
                        trigger={(t) => (
                          <button {...t} className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2" aria-label={`More actions for ${f.displayName}`}>
                            <MoreHorizontal className="h-5 w-5" />
                          </button>
                        )}
                        items={[
                          { label: 'View profile', icon: <UserRound className="h-4 w-4" />, onSelect: () => navigate(`/app/u/${f.userId}`) },
                          { label: 'Remove friend', icon: <UserMinus className="h-4 w-4" />, onSelect: () => setConfirm({ kind: 'remove', userId: f.userId, name: f.displayName }) },
                          { label: 'Block', icon: <Ban className="h-4 w-4" />, danger: true, onSelect: () => setConfirm({ kind: 'block', userId: f.userId, name: f.displayName }) },
                        ]}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {presence.data && <p className="mt-2 text-xs text-muted">Online status is approximate and respects each friend's privacy settings.</p>}
          </>
        )}

        {(tab === 'incoming' || tab === 'sent') &&
          (requests.isLoading ? (
            <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : requests.isError ? (
            <ErrorState message={errorMessage(requests.error)} onRetry={() => requests.refetch()} />
          ) : (tab === 'incoming' ? incoming : sent).length === 0 ? (
            <EmptyState icon={<Users className="h-6 w-6" />} title={tab === 'incoming' ? 'No pending requests' : 'No sent requests'} body="Friend requests can be sent from an active chat or from your recent History." />
          ) : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface">
              {(tab === 'incoming' ? incoming : sent).map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                  <Avatar seed={r.other.avatarSeed} style={r.other.avatarStyle} size={44} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.other.displayName}</p>
                    <p className="text-xs text-muted">
                      <Badge tone="warning">Pending</Badge> · {timeAgo(r.createdAt)}
                    </p>
                  </div>
                  {r.direction === 'incoming' ? (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => act.mutate({ path: `/api/friend-requests/${r.id}/accept`, method: 'POST', ok: `You and ${r.other.displayName} are now friends` })} leftIcon={<Check className="h-4 w-4" />} disabled={act.isPending}>
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/friend-requests/${r.id}/decline`, method: 'POST', ok: 'Request declined' })} disabled={act.isPending}>
                        Decline
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => act.mutate({ path: `/api/friend-requests/${r.id}`, method: 'DELETE', ok: 'Request cancelled' })} leftIcon={<X className="h-4 w-4" />} disabled={act.isPending}>
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </div>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} size="sm" title={confirm?.kind === 'block' ? `Block ${confirm?.name}?` : `Remove ${confirm?.name}?`} description={confirm?.kind === 'block' ? 'Blocking removes the friendship, stops DMs and friend requests, hides your presence, and prevents future random matches.' : 'Your past messages stay readable for both of you, but the conversation becomes read-only.'}>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={doConfirm} loading={act.isPending}>
            {confirm?.kind === 'block' ? 'Block' : 'Remove'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
