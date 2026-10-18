import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useMatch } from 'react-router-dom';
import { Bell, Compass, History, Inbox, MessageCircle, Settings, ShieldCheck, User, Users } from 'lucide-react';
import { useAuth } from '@/stores/authStore';
import { useMe, useUnread } from '@/hooks/queries';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { chatClient, useChat } from '@/services/chatClient';
import { Logo } from '@/components/ui/Logo';
import { Avatar } from '@/components/ui/Avatar';
import { CountBadge } from '@/components/ui/Feedback';
import { cn } from '@/lib/utils';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { ConnectionBanner } from './ConnectionBanner';

const NAV = [
  { to: '/app', label: 'Discover', icon: Compass, end: true },
  { to: '/app/chat', label: 'Random Chat', short: 'Chat', icon: MessageCircle },
  { to: '/app/friends', label: 'Friends', icon: Users, badge: 'friendRequests' as const },
  { to: '/app/inbox', label: 'Direct Messages', short: 'Inbox', icon: Inbox, badge: 'dms' as const },
  { to: '/app/history', label: 'History', icon: History },
  { to: '/app/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' as const },
  { to: '/app/profile', label: 'Profile', icon: User },
  { to: '/app/settings', label: 'Settings', icon: Settings },
];
const MOBILE = ['/app', '/app/chat', '/app/friends', '/app/inbox', '/app/profile'];

export function AppShell() {
  const userId = useAuth((s) => s.userId);
  const me = useMe().data;
  const unread = useUnread().data;
  const phase = useChat((s) => s.phase);
  const loc = useLocation();
  const inThread = useMatch('/app/inbox/:conversationId');
  const inChat = loc.pathname === '/app/chat' && (phase === 'matched' || phase === 'searching');
  useRealtimeSync(userId);

  // Lobby socket = presence. Open while the user is inside the app.
  useEffect(() => {
    chatClient.ensureLobby();
  }, []);

  const focusMode = !!inThread || inChat;

  return (
    <div className="flex h-vvh min-h-0 w-full overflow-hidden lg:h-[100dvh]">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border/60 bg-surface/50 px-3 py-4 lg:flex" aria-label="Main navigation">
        <NavLink to="/app" className="mb-6 px-3">
          <Logo />
        </NavLink>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors', isActive ? 'bg-primary/15 text-primary' : 'text-muted hover:bg-surface-2 hover:text-fg')
              }
            >
              <n.icon className="h-5 w-5" aria-hidden />
              <span className="flex-1">{n.label}</span>
              {n.badge && <CountBadge count={unread?.[n.badge] ?? 0} />}
            </NavLink>
          ))}
          {me?.isAdmin && (
            <NavLink to="/admin" className="mt-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-coral hover:bg-surface-2">
              <ShieldCheck className="h-5 w-5" aria-hidden /> Moderation
            </NavLink>
          )}
        </nav>
        {me && (
          <NavLink to="/app/profile" className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-2/60 p-2.5">
            <Avatar seed={me.avatarSeed} style={me.avatarStyle} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{me.displayName}</p>
              <p className="text-xs text-muted">{me.isAnonymous ? 'Guest account' : 'Google account'}</p>
            </div>
          </NavLink>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile/tablet top bar */}
        {!focusMode && (
          <header className="glass sticky top-0 z-30 flex items-center justify-between border-b border-border/60 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] lg:hidden">
            <NavLink to="/app" aria-label="Home">
              <Logo />
            </NavLink>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell />
            </div>
          </header>
        )}
        {/* Desktop top bar */}
        <header className="hidden items-center justify-end gap-2 border-b border-border/60 px-6 py-3 lg:flex">
          <ThemeToggle />
          <NotificationBell />
        </header>
        <ConnectionBanner />
        {me?.restriction && (
          <div role="alert" className="bg-danger/15 px-4 py-2 text-center text-sm font-semibold text-danger">
            Your account is {me.restriction.kind === 'ban' ? 'banned' : `suspended${me.restriction.until ? ` until ${new Date(me.restriction.until).toLocaleString()}` : ''}`}. Chat features are unavailable.
          </div>
        )}
        <main id="main" className={cn('min-h-0 flex-1 overflow-y-auto scrollbar-thin', focusMode && 'overflow-hidden')}>
          <Outlet />
        </main>
        {/* Mobile bottom navigation */}
        {!focusMode && (
          <nav className="glass z-30 grid grid-cols-5 border-t border-border/60 pb-safe lg:hidden" aria-label="Main navigation">
            {NAV.filter((n) => MOBILE.includes(n.to)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => cn('relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold', isActive ? 'text-primary' : 'text-muted')}
              >
                <n.icon className="h-6 w-6" aria-hidden />
                {n.short ?? n.label}
                {n.badge && <CountBadge count={unread?.[n.badge] ?? 0} className="absolute right-[22%] top-1" />}
              </NavLink>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
