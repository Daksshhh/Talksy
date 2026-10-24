import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Bookmark, EyeOff, Flag, UserPlus } from 'lucide-react';
import { useHistoryItem, useInvalidateSocial } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/stores/uiStore';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';
import { ReportDialog } from '@/components/chat/ReportDialog';
import { SafeText } from '@/components/chat/SafeText';
import { cn, clockTime, formatDuration } from '@/lib/utils';

export default function HistoryDetailPage() {
  const { sessionId = '' } = useParams();
  const q = useHistoryItem(sessionId);
  const invalidate = useInvalidateSocial();
  const navigate = useNavigate();
  const [report, setReport] = useState(false);
  const [confirm, setConfirm] = useState<'hide' | 'transcript' | 'block' | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>, ok: string, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: 'success' });
      invalidate();
      q.refetch();
      after?.();
    } catch (e) {
      toast({ title: 'Action failed', body: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  if (q.isLoading) return <div className="mx-auto max-w-3xl space-y-3 p-6"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  if (q.isError || !q.data) return <ErrorState className="mt-10" title="History item not found" message={errorMessage(q.error)} />;
  const it = q.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <Link to="/app/history" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> History
      </Link>
      <div className="mt-4 flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
        <Avatar seed={it.strangerAvatarSeed || it.sessionId.slice(0, 8)} size={56} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold">{it.strangerName}</h1>
          <p className="text-sm text-muted">
            {new Date(it.startedAt).toLocaleString()} · {formatDuration(it.durationSec)} · you were “{it.myName}”
          </p>
          <div className="mt-1 flex gap-1.5">
            {it.becameFriends && <Badge tone="success">Friends</Badge>}
            {it.friendRequestSent && !it.becameFriends && <Badge>Request sent</Badge>}
            {it.endReason && <Badge>Ended: {it.endReason}</Badge>}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {it.canSendFriendRequest && !it.friendRequestSent && (
          <Button size="sm" leftIcon={<UserPlus className="h-4 w-4" />} loading={busy} onClick={() => run(() => api('/api/friend-requests', { method: 'POST', body: { sessionId } }), 'Friend request sent')}>
            Send friend request
          </Button>
        )}
        <Button size="sm" variant="ghost" leftIcon={<Flag className="h-4 w-4" />} onClick={() => setReport(true)}>Report</Button>
        <Button size="sm" variant="ghost" leftIcon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('block')}>Block</Button>
        <Button size="sm" variant="ghost" leftIcon={<EyeOff className="h-4 w-4" />} onClick={() => setConfirm('hide')}>Remove from history</Button>
      </div>

      <section className="mt-6" aria-labelledby="transcript-h">
        <h2 id="transcript-h" className="flex items-center gap-2 font-bold"><Bookmark className="h-4 w-4 text-primary" aria-hidden /> Saved conversation</h2>
        {it.transcript && it.transcript.length ? (
          <>
            <p className="mt-1 text-xs text-muted">
              Saved with both participants' consent{it.transcriptExpiresAt ? ` · auto-deletes ${new Date(it.transcriptExpiresAt).toLocaleDateString()}` : ''}.{' '}
              <button className="font-semibold text-danger hover:underline" onClick={() => setConfirm('transcript')}>Delete my access</button>
            </p>
            <ol className="mt-3 space-y-1.5 rounded-2xl border border-border bg-surface p-4">
              {it.transcript.map((m) => (
                <li key={m.id} className={cn('flex', m.from === 'me' ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[80%] whitespace-pre-wrap break-anywhere rounded-2xl px-3 py-1.5 text-sm', m.from === 'me' ? 'bg-primary/15' : 'bg-surface-2')}>
                    <SafeText text={m.text} />
                    <span className="ml-2 text-[10px] text-muted">{clockTime(m.ts)}</span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">No user-visible saved transcript. During initial testing, the operator may retain messages for limited review as described in the Privacy Policy.</p>
        )}
      </section>

      <ReportDialog
        open={report}
        onClose={() => setReport(false)}
        subject={it.strangerName}
        evidenceNote="This chat has ended, so only the session details are shared with moderators."
        onSubmit={async (r) => {
          await api('/api/reports', { method: 'POST', body: { ...r, context: 'random_chat', sessionId } });
          toast({ title: 'Report sent', tone: 'success' });
          invalidate();
        }}
      />
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        size="sm"
        title={confirm === 'block' ? `Block ${it.strangerName}?` : confirm === 'hide' ? 'Remove from history?' : 'Delete your access to this transcript?'}
        description={confirm === 'block' ? "You won't be matched or contacted again." : confirm === 'hide' ? 'This removes the entry and your access to any saved transcript.' : 'When neither participant keeps access, the transcript is permanently deleted.'}
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() =>
              confirm === 'block'
                ? run(() => api('/api/blocks', { method: 'POST', body: { sessionId } }), 'User blocked')
                : confirm === 'hide'
                  ? run(() => api(`/api/history/${sessionId}`, { method: 'DELETE' }), 'Removed from history', () => navigate('/app/history'))
                  : run(() => api(`/api/history/${sessionId}/transcript`, { method: 'DELETE' }), 'Transcript access removed')
            }
          >
            Confirm
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
