import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Inbox, Shield, Sparkles, Users } from 'lucide-react';
import { useFriendPresence, useFriends, useInbox, useMe } from '@/hooks/queries';
import { useChat, chatClient } from '@/services/chatClient';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { CountBadge, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { GuestUpgradeCard } from '@/components/auth/GuestUpgradeCard';
import { timeAgo } from '@/lib/utils';
import type { AvatarStyle } from '@orbit/shared';

export default function DiscoverPage() {
  const me = useMe().data!;
  const counts = useChat((s) => s.counts);
  const navigate = useNavigate();
  const friends = useFriends();
  const presence = useFriendPresence();
  const inbox = useInbox();
  const online = (friends.data ?? []).filter((f) => ['online', 'in_chat', 'searching'].includes(presence.data?.[f.userId] ?? ''));

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <section className="relative overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
        <p className="text-sm font-semibold text-primary">Welcome back</p>
        <h1 className="mt-1 text-3xl font-extrabold">Hey {me.displayName} 👋</h1>
        <p className="mt-2 max-w-lg text-muted">Who will you meet today? Matching is random and instant — everyone is welcome.</p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button
            size="lg"
            onClick={() => {
              chatClient.start();
              navigate('/app/chat');
            }}
          >
            Start Random Chat <ArrowRight className="h-5 w-5" aria-hidden />
          </Button>
          <div className="text-sm text-muted" aria-live="polite">
            {counts ? (
              <span>
                <strong className="text-fg">~{counts.online}</strong> online · <strong className="text-fg">{counts.inChat}</strong> chatting · <strong className="text-fg">{counts.waiting}</strong> searching
              </span>
            ) : (
              <Skeleton className="h-5 w-48" />
            )}
          </div>
        </div>
      </section>

      {me.isAnonymous && <GuestUpgradeCard compact />}

      <div className="grid gap-5 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" aria-hidden /> Friends online
            </CardTitle>
            <Link to="/app/friends" className="text-sm font-semibold text-primary hover:underline">
              All friends
            </Link>
          </CardHeader>
          <CardBody>
            {friends.isLoading ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : friends.isError ? (
              <ErrorState message="Couldn't load friends." onRetry={() => friends.refetch()} />
            ) : online.length === 0 ? (
              <EmptyState className="py-6" title={friends.data?.length ? 'No friends online right now' : 'Your friends list is empty.'} body={friends.data?.length ? 'Presence updates about every 30 seconds.' : 'Meet someone through random chat and send a friend request.'} />
            ) : (
              <ul className="space-y-2">
                {online.slice(0, 6).map((f) => (
                  <li key={f.userId}>
                    <Link to={f.conversationId ? `/app/inbox/${f.conversationId}` : `/app/u/${f.userId}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
                      <Avatar seed={f.avatarSeed} style={f.avatarStyle} size={36} status={presence.data?.[f.userId]} />
                      <span className="flex-1 truncate font-semibold">{f.displayName}</span>
                      <span className="text-xs text-muted">{presence.data?.[f.userId] === 'in_chat' ? 'In a chat' : 'Online'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-primary" aria-hidden /> Recent messages
            </CardTitle>
            <Link to="/app/inbox" className="text-sm font-semibold text-primary hover:underline">
              Inbox
            </Link>
          </CardHeader>
          <CardBody>
            {inbox.isLoading ? (
              <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : inbox.isError ? (
              <ErrorState message="Couldn't load messages." onRetry={() => inbox.refetch()} />
            ) : !inbox.data?.some((c) => c.lastMessage) ? (
              <EmptyState className="py-6" title="No messages yet" body="Once you make a friend, your private conversations show up here." />
            ) : (
              <ul className="space-y-1">
                {inbox.data
                  .filter((c) => c.lastMessage)
                  .slice(0, 5)
                  .map((c) => (
                    <li key={c.conversationId}>
                      <Link to={`/app/inbox/${c.conversationId}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-surface-2">
                        <Avatar seed={c.peerAvatarSeed ?? 'x'} style={(c.peerAvatarStyle ?? 'orbit') as AvatarStyle} size={36} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{c.peerName ?? 'Deleted user'}</p>
                          <p className="truncate text-xs text-muted">
                            {c.lastMessage!.fromMe ? 'You: ' : ''}
                            {c.lastMessage!.body}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-[11px] text-muted">{timeAgo(c.lastMessage!.createdAt)}</span>
                          <CountBadge count={c.unread} />
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Card className="border-primary/30 bg-gradient-to-br from-primary/10 to-accent/5">
          <CardBody>
            <Sparkles className="h-6 w-6 text-primary" aria-hidden />
            <h2 className="mt-2 font-bold">Conversation Quest</h2>
            <p className="mt-1 text-sm text-muted">Inside any chat, open the menu and start a quest — This or That, Would You Rather, Culture Exchange and more. Both of you answer, then reveal together.</p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <Shield className="h-6 w-6 text-success" aria-hidden />
            <h2 className="mt-2 font-bold">Community & safety</h2>
            <p className="mt-1 text-sm text-muted">Be kind, stay anonymous, and use Report/Block whenever something feels off.</p>
            <div className="mt-3 flex gap-3 text-sm font-semibold">
              <Link to="/guidelines" className="text-primary hover:underline">
                Guidelines
              </Link>
              <Link to="/report-abuse" className="text-primary hover:underline">
                Report abuse
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
