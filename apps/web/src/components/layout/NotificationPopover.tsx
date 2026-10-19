import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, CheckCheck, ChevronRight, MessageSquare, ShieldAlert, UserCheck, UserPlus } from 'lucide-react';
import type { NotificationView } from '@orbit/shared';
import { useMarkNotificationsRead, useNotifications, useUnread } from '@/hooks/queries';
import { CountBadge } from '@/components/ui/Feedback';
import { cn, timeAgo } from '@/lib/utils';

const ICON = { friend_request: UserPlus, friend_accepted: UserCheck, dm: MessageSquare, safety: ShieldAlert, system: Bell };

function target(n: NotificationView): string {
  if (n.type === 'friend_request') return '/app/friends?tab=incoming';
  if ((n.type === 'friend_accepted' || n.type === 'dm') && n.data.conversationId) return `/app/inbox/${n.data.conversationId}`;
  return '/app/settings';
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const unread = useUnread().data?.notifications ?? 0;
  const notifications = useNotifications();
  const mark = useMarkNotificationsRead();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const select = (notification: NotificationView) => {
    if (!notification.readAt) mark.mutate([notification.id]);
    setOpen(false);
    navigate(target(notification));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn('relative grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-surface hover:text-fg', open && 'bg-surface text-primary shadow-soft')}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Bell className="h-5 w-5" />
        <CountBadge count={unread} className="absolute -right-0.5 -top-0.5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed inset-x-3 top-[calc(4.75rem+env(safe-area-inset-top))] z-50 overflow-hidden rounded-3xl border border-border bg-surface shadow-[0_24px_70px_rgb(0_0_0/0.5)] ring-1 ring-black/10 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <h2 className="font-extrabold">Notifications</h2>
                <p className="text-xs text-muted">{unread ? `${unread} unread` : 'You are all caught up'}</p>
              </div>
              <button
                type="button"
                disabled={!unread || mark.isPending}
                onClick={() => mark.mutate(null)}
                className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                <CheckCheck className="h-4 w-4" /> Mark read
              </button>
            </div>

            <div className="max-h-[min(60vh,420px)] overflow-y-auto">
              {notifications.isLoading ? (
                <p className="px-4 py-8 text-center text-sm text-muted">Loading notifications?</p>
              ) : notifications.isError ? (
                <p className="px-4 py-8 text-center text-sm text-danger">Could not load notifications.</p>
              ) : !notifications.data?.length ? (
                <div className="px-6 py-9 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Bell className="h-5 w-5" /></span>
                  <p className="mt-3 font-bold">Nothing new</p>
                  <p className="mt-1 text-sm text-muted">New messages and friend activity will appear here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border/70">
                  {notifications.data.slice(0, 5).map((notification) => {
                    const Icon = ICON[notification.type] ?? Bell;
                    return (
                      <li key={notification.id}>
                        <button type="button" onClick={() => select(notification)} className={cn('flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-surface-2', !notification.readAt && 'bg-primary/5')}>
                          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', notification.type === 'safety' ? 'bg-danger/15 text-danger' : 'bg-primary/15 text-primary')}>
                            <Icon className="h-5 w-5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block text-sm', notification.readAt ? 'font-semibold' : 'font-extrabold')}>{notification.title}</span>
                            <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">{notification.body}</span>
                            <span className="mt-1 block text-[11px] text-muted">{timeAgo(notification.createdAt)}</span>
                          </span>
                          {!notification.readAt && <span className="mt-2 h-2.5 w-2.5 rounded-full bg-coral" aria-label="Unread" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <button type="button" onClick={() => { setOpen(false); navigate('/app/notifications'); }} className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-3 text-sm font-bold text-primary hover:bg-primary/10">
              View all notifications <ChevronRight className="h-4 w-4" />
            </button>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
