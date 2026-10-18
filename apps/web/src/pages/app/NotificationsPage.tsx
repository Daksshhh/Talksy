import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, MessageSquare, ShieldAlert, UserCheck, UserPlus } from 'lucide-react';
import type { NotificationView } from '@orbit/shared';
import { useMarkNotificationsRead, useNotifications } from '@/hooks/queries';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { errorMessage } from '@/lib/api';
import { cn, timeAgo } from '@/lib/utils';

const ICON = { friend_request: UserPlus, friend_accepted: UserCheck, dm: MessageSquare, safety: ShieldAlert, system: Bell };

function target(n: NotificationView): string {
  if (n.type === 'friend_request') return '/app/friends?tab=incoming';
  if ((n.type === 'friend_accepted' || n.type === 'dm') && n.data.conversationId) return `/app/inbox/${n.data.conversationId}`;
  return '/app/settings';
}

export default function NotificationsPage() {
  const q = useNotifications();
  const mark = useMarkNotificationsRead();
  const navigate = useNavigate();
  const unread = (q.data ?? []).filter((n) => !n.readAt).length;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">Notifications</h1>
        <Button size="sm" variant="ghost" disabled={!unread || mark.isPending} onClick={() => mark.mutate(null)} leftIcon={<CheckCheck className="h-4 w-4" />}>
          Mark all as read
        </Button>
      </div>
      <div className="mt-4">
        {q.isLoading ? (
          <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : q.isError ? (
          <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon={<Bell className="h-6 w-6" />} title="You're all caught up" body="Friend requests, new messages and account notices will appear here." />
        ) : (
          <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface">
            {q.data.map((n) => {
              const Icon = ICON[n.type] ?? Bell;
              return (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      if (!n.readAt) mark.mutate([n.id]);
                      navigate(target(n));
                    }}
                    className={cn('flex w-full items-start gap-3 p-3.5 text-left hover:bg-surface-2', !n.readAt && 'bg-primary/5')}
                  >
                    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', n.type === 'safety' ? 'bg-danger/15 text-danger' : 'bg-primary/15 text-primary')}>
                      <Icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', !n.readAt ? 'font-bold' : 'font-semibold')}>{n.title}</span>
                      <span className="block text-sm text-muted break-anywhere">{n.body}</span>
                      <span className="mt-0.5 block text-xs text-muted">{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.readAt && <span className="mt-2 h-2.5 w-2.5 rounded-full bg-coral" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
