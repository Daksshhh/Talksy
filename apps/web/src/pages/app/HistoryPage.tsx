import { Link } from 'react-router-dom';
import { Bookmark, Clock, History as HistoryIcon, UserCheck, UserPlus } from 'lucide-react';
import { useHistory } from '@/hooks/queries';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, EmptyState, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';
import { errorMessage } from '@/lib/api';
import { formatDuration, timeAgo } from '@/lib/utils';

export default function HistoryPage() {
  const h = useHistory();
  const items = h.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-extrabold">History</h1>
      <p className="mt-1 text-sm text-muted">
        Random chats keep only metadata (time, duration, the stranger's nickname). Message transcripts exist only when both people agreed to save them, and are deleted after 90
        days. Friend DMs live in your <Link to="/app/inbox" className="font-semibold text-primary hover:underline">Inbox</Link>.
      </p>
      <div className="mt-5">
        {h.isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : h.isError ? (
          <ErrorState message={errorMessage(h.error)} onRetry={() => h.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon={<HistoryIcon className="h-6 w-6" />} title="No chats yet" body="Your random chats will appear here after you meet someone." action={<Link to="/app/chat"><Button>Start a chat</Button></Link>} />
        ) : (
          <>
            <ul className="divide-y divide-border/60 rounded-2xl border border-border bg-surface">
              {items.map((it) => (
                <li key={it.sessionId}>
                  <Link to={`/app/history/${it.sessionId}`} className="flex items-center gap-3 p-3 hover:bg-surface-2">
                    <Avatar seed={it.strangerAvatarSeed || it.sessionId.slice(0, 8)} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{it.strangerName ?? 'Stranger'}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                        <span>{timeAgo(it.startedAt)}</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden />{formatDuration(it.durationSec)}</span>
                        {it.status !== 'ENDED' && <Badge tone="success">Live</Badge>}
                      </p>
                    </div>
                    <div className="flex gap-1.5">
                      {it.transcriptSaved && <Badge tone="primary"><Bookmark className="h-3 w-3" aria-hidden />Saved</Badge>}
                      {it.becameFriends ? <Badge tone="success"><UserCheck className="h-3 w-3" aria-hidden />Friends</Badge> : it.friendRequestSent ? <Badge><UserPlus className="h-3 w-3" aria-hidden />Requested</Badge> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {h.hasNextPage && (
              <div className="mt-4 text-center">
                <Button variant="outline" onClick={() => h.fetchNextPage()} loading={h.isFetchingNextPage}>Load more</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
