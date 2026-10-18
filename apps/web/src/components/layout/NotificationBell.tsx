import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useUnread } from '@/hooks/queries';
import { CountBadge } from '@/components/ui/Feedback';

export function NotificationBell() {
  const n = useUnread().data?.notifications ?? 0;
  return (
    <Link to="/app/notifications" className="relative grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notifications${n ? `, ${n} unread` : ''}`}>
      <Bell className="h-5 w-5" />
      <CountBadge count={n} className="absolute -right-0.5 -top-0.5" />
    </Link>
  );
}
