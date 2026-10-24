import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Ban,
  Bookmark,
  Flag,
  Loader2,
  MessageCircle,
  MoreVertical,
  ShieldCheck,
  SkipForward,
  Sparkles,
  UserPlus,
  Users,
  X,
  LogOut,
} from 'lucide-react';
import { CONVERSATION_STARTERS, LIMITS } from '@orbit/shared';
import { chatClient, useChat } from '@/services/chatClient';
import { toast } from '@/stores/uiStore';
import { useMe } from '@/hooks/queries';
import { api, errorMessage } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { Menu } from '@/components/ui/Menu';
import { Dialog } from '@/components/ui/Dialog';
import { MessageList, type ListMessage } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';
import { ReportDialog } from '@/components/chat/ReportDialog';
import { QuestPanel, QuestPicker } from '@/components/quests/QuestPanel';
import { cn } from '@/lib/utils';

export default function ChatPage() {
  const phase = useChat((s) => s.phase);
  const me = useMe().data;
  const location = useLocation();
  const navigate = useNavigate();
  const autoStartHandled = useRef(false);

  const shouldAutoStart = (location.state as { autoStart?: boolean } | null)?.autoStart;

  useEffect(() => {
    chatClient.ensureLobby();
    if (!me || me.restriction || !shouldAutoStart || autoStartHandled.current) return;
    autoStartHandled.current = true;
    chatClient.start();
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, me, navigate, shouldAutoStart]);
  useEffect(() => {
    document.title = phase === 'matched' ? 'Chatting — Talksy' : 'Random Chat — Talksy';
  }, [phase]);

  if (me?.restriction) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <Ban className="mx-auto h-10 w-10 text-danger" aria-hidden />
          <h1 className="mt-3 text-xl font-bold">Random chat is unavailable</h1>
          <p className="mt-1 text-sm text-muted">
            Your account is restricted. Contact support if you believe this is a mistake.
          </p>
        </div>
      </div>
    );
  }
  if (phase === 'idle' || phase === 'connecting') return <IdleState />;
  if (phase === 'searching') return <SearchingState />;
  return <ChatView />;
}

// ---------------------------------------------------------------- idle
function IdleState() {
  const counts = useChat((s) => s.counts);
  const notice = useChat((s) => s.notice);
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-8 px-5 py-10 text-center">
      <div className="relative grid h-36 w-36 place-items-center">
        <span className="absolute inset-0 rounded-full border border-primary/30" />
        <span className="absolute inset-4 rounded-full border border-accent/30" />
        <span className="absolute inset-0 animate-orbit">
          <span className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-coral shadow-[0_0_16px_rgb(var(--coral))]" />
        </span>
        <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-gradient text-primary-fg shadow-glow">
          <MessageCircle className="h-9 w-9" aria-hidden />
        </div>
      </div>
      <div>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Ready to meet someone?</h1>
        <p className="mx-auto mt-2 max-w-md text-muted">
          We pair you with the first available person — anywhere in the world, completely at random.
          No filters, no algorithms, just a hello.
        </p>
        {counts && counts.online > 0 && (
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success">
            <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> ~{counts.online} online
            now
          </p>
        )}
      </div>
      <Button
        size="lg"
        className="w-full max-w-xs text-lg"
        onClick={() => chatClient.start()}
        data-testid="start-chat"
      >
        Start Chat
      </Button>
      {notice && (
        <p role="alert" className="text-sm text-warning">
          {notice}
        </p>
      )}
      <div className="grid w-full gap-3 text-left sm:grid-cols-2">
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <ShieldCheck className="h-4 w-4 text-success" aria-hidden /> Stay safe
          </p>
          <p className="mt-1 text-xs text-muted">
            Don't share personal details. Report or block anyone, anytime. Links from strangers
            aren't clickable.
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Need an opener?
          </p>
          <p className="mt-1 text-xs text-muted">
            “{CONVERSATION_STARTERS[new Date().getMinutes() % CONVERSATION_STARTERS.length]}”
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- searching
function SearchingState() {
  const queue = useChat((s) => s.queue);
  const conn = useChat((s) => s.conn);
  const reduce = useReducedMotion();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const since = queue?.since ?? Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - since) / 1000)), 1000);
    return () => clearInterval(t);
  }, [queue?.since]);
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-8 px-5 text-center"
      aria-busy="true"
    >
      <div className="relative grid h-48 w-48 place-items-center">
        {!reduce &&
          [0, 0.7, 1.4].map((d) => (
            <span
              key={d}
              className="absolute h-24 w-24 rounded-full bg-primary/25 animate-pulse-ring"
              style={{ animationDelay: `${d}s` }}
            />
          ))}
        <span className="absolute inset-6 animate-orbit-fast rounded-full border-2 border-dashed border-accent/40" />
        <div className="grid h-20 w-20 place-items-center rounded-full bg-brand-gradient text-primary-fg shadow-glow">
          <Users className="h-9 w-9" aria-hidden />
        </div>
      </div>
      <div role="status" aria-live="polite">
        <h1 className="text-2xl font-extrabold">Finding someone to chat with…</h1>
        <p className="mt-2 text-sm text-muted">
          {conn !== 'online'
            ? 'Reconnecting to the matchmaker…'
            : elapsed < 3
              ? 'Looking around the world'
              : `Searching for ${elapsed}s`}
          {queue && queue.waiting > 1 && conn === 'online'
            ? ` · ${queue.waiting} people waiting`
            : ''}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => chatClient.cancel()}
        leftIcon={<X className="h-4 w-4" />}
      >
        Cancel Search
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------- connected / ended
function ChatView() {
  const s = useChat();
  const reduce = useReducedMotion();
  const [reportOpen, setReportOpen] = useState(false);
  const [questOpen, setQuestOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [busy, setBusy] = useState<'friend' | 'block' | null>(null);
  const ended = s.phase === 'ended';
  const peerName = s.peer?.displayName ?? 'Stranger';
  const live = !ended && s.roomReady && s.conn === 'online';

  const list: ListMessage[] = useMemo(
    () =>
      s.messages.map((m) => ({
        key: m.clientMsgId && m.from === 'me' ? `c-${m.clientMsgId}` : m.id,
        from: m.from,
        text: m.text,
        ts: m.ts,
        status: m.status,
        error: m.error,
      })),
    [s.messages],
  );

  const sendFriendRequest = async () => {
    if (!s.sessionId) return;
    setBusy('friend');
    try {
      const r = await api<{ status: 'pending' | 'accepted' }>('/api/friend-requests', {
        method: 'POST',
        body: { sessionId: s.sessionId },
      });
      chatClient.markFriendRequestSent(r.status);
      toast({
        title:
          r.status === 'accepted' ? `You and ${peerName} are now friends!` : 'Friend request sent',
        tone: 'success',
      });
    } catch (e) {
      toast({ title: 'Could not send request', body: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const block = async () => {
    if (!s.sessionId) return;
    setBusy('block');
    try {
      await api('/api/blocks', { method: 'POST', body: { sessionId: s.sessionId } });
      toast({
        title: `${peerName} is blocked`,
        body: "You won't be matched or contacted again.",
        tone: 'success',
      });
      if (!ended) chatClient.end();
    } catch (e) {
      toast({ title: 'Could not block', body: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
      setConfirmBlock(false);
    }
  };

  const status = ended
    ? 'Disconnected'
    : !s.roomReady
      ? s.conn === 'online'
        ? 'Connecting…'
        : 'Reconnecting…'
      : s.peerConnected
        ? 'Connected'
        : 'Stranger reconnecting…';

  const friendLabel =
    s.friendRequest === 'friends'
      ? 'Friends ✓'
      : s.friendRequest === 'sent'
        ? 'Request sent'
        : s.friendRequest === 'received'
          ? 'Accept friend request'
          : 'Add friend';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <header className="glass relative z-50 flex shrink-0 items-center gap-3 overflow-visible border-b border-border/60 px-3 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] sm:px-6 lg:pt-2.5">
        <Avatar
          seed={s.peer?.avatarSeed ?? 'x'}
          style={s.peer?.avatarStyle}
          size={40}
          status={live && s.peerConnected ? 'online' : 'offline'}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{peerName}</p>
          <p
            className={cn(
              'flex items-center gap-1 text-xs',
              live && s.peerConnected ? 'text-success' : 'text-muted',
            )}
            role="status"
          >
            {!ended && !live && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {status}
          </p>
        </div>
        {!ended && (
          <Button
            size="sm"
            variant="secondary"
            className="hidden sm:inline-flex"
            onClick={sendFriendRequest}
            disabled={
              s.friendRequest === 'sent' || s.friendRequest === 'friends' || busy === 'friend'
            }
            leftIcon={<UserPlus className="h-4 w-4" />}
          >
            {friendLabel}
          </Button>
        )}
        <Menu
          label="Chat actions"
          trigger={(p) => (
            <button
              {...p}
              className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2"
              aria-label="More actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          )}
          items={[
            {
              label: friendLabel,
              icon: <UserPlus className="h-4 w-4" />,
              onSelect: sendFriendRequest,
              disabled: s.friendRequest === 'sent' || s.friendRequest === 'friends',
            },
            {
              label: 'Start Conversation Quest',
              icon: <Sparkles className="h-4 w-4" />,
              onSelect: () => setQuestOpen(true),
              disabled: !live || !!s.quest,
            },
            {
              label: s.save === 'saved' ? 'Conversation will be saved' : 'Save conversation',
              icon: <Bookmark className="h-4 w-4" />,
              onSelect: () => chatClient.requestSave(),
              disabled: !live || s.save === 'saved' || s.save === 'requested_by_me',
            },
            {
              label: 'Report',
              icon: <Flag className="h-4 w-4" />,
              onSelect: () => setReportOpen(true),
              danger: true,
              disabled: s.reported,
            },
            {
              label: 'Block',
              icon: <Ban className="h-4 w-4" />,
              onSelect: () => setConfirmBlock(true),
              danger: true,
            },
            ...(!ended
              ? [
                  {
                    label: 'End chat',
                    icon: <LogOut className="h-4 w-4" />,
                    onSelect: () => setConfirmEnd(true),
                    danger: true,
                  },
                ]
              : []),
          ]}
        />
      </header>

      <SaveBanner />

      <MessageList
        messages={list}
        peerName={peerName}
        typing={s.peerTyping && live}
        onRetry={(key) => chatClient.retry(key.replace(/^c-/, ''))}
        header={
          <div className="mb-4 text-center">
            <p className="text-sm text-muted">
              You're chatting with <strong className="text-fg">{peerName}</strong>. Say hi! 👋
            </p>
            <p className="mt-1 text-[11px] text-muted">
              During initial testing, messages are securely stored for up to {LIMITS.TESTING_CHAT_RETENTION_DAYS} days for review.
            </p>
            {!s.quest && !ended && (
              <button
                onClick={() => setQuestOpen(true)}
                disabled={!live}
                className="mx-auto mt-4 flex min-h-14 items-center gap-3 rounded-2xl border border-primary/40 bg-primary/10 px-4 py-2.5 text-left text-primary shadow-soft transition hover:border-primary hover:bg-primary/15 disabled:opacity-50"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15">
                  <Sparkles className="h-5 w-5" aria-hidden />
                </span>
                <span>
                  <strong className="block text-sm">Play a random game</strong>
                  <span className="block text-xs text-muted">
                    Break the ice with a quick Conversation Quest
                  </span>
                </span>
              </button>
            )}
          </div>
        }
        emptyContent={
          !ended ? (
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid min-h-[38vh] place-items-center px-4 pb-6 pt-2 text-center"
              data-testid="match-found"
            >
              <div>
                <div className="relative mx-auto grid h-28 w-28 place-items-center">
                  <motion.span
                    className="absolute inset-1 rounded-full border border-primary/30"
                    animate={reduce ? undefined : { scale: [0.92, 1.12], opacity: [0.6, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeOut' }}
                  />
                  <motion.span
                    className="absolute inset-3 rounded-full border border-dashed border-accent/45"
                    animate={reduce ? undefined : { rotate: 360 }}
                    transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
                  />
                  <motion.div
                    animate={reduce ? undefined : { y: [0, -4, 0] }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Avatar
                      seed={s.peer?.avatarSeed ?? 'x'}
                      style={s.peer?.avatarStyle}
                      size={68}
                      status="online"
                    />
                  </motion.div>
                  <motion.span
                    initial={reduce ? false : { scale: 0, rotate: -20 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: 0.25, type: 'spring' }}
                    className="absolute right-1 top-2 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-fg shadow-glow"
                  >
                    <Sparkles className="h-4 w-4" aria-hidden />
                  </motion.span>
                </div>
                <motion.p
                  initial={reduce ? false : { opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.12 }}
                  className="mx-auto mt-4 w-fit rounded-full bg-success/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.16em] text-success"
                >
                  Match found
                </motion.p>
                <h2 className="mt-3 text-xl font-extrabold">You found {peerName}</h2>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted">
                  The chat is ready. Send a hello or play a random game to break the ice.
                </p>
              </div>
            </motion.div>
          ) : null
        }
        footer={
          ended ? (
            <EndedBanner
              peerName={peerName}
              onReport={() => setReportOpen(true)}
              onFriend={sendFriendRequest}
            />
          ) : null
        }
      />

      {!ended && <QuestPanel quest={s.quest} peerName={peerName} notice={s.questNotice} />}
      {s.notice && !ended && (
        <p role="alert" className="px-4 pb-1 text-center text-xs text-warning">
          {s.notice}{' '}
          <button className="underline" onClick={() => chatClient.clearNotice()}>
            Dismiss
          </button>
        </p>
      )}

      {/* Composer with a compact, two-step skip confirmation */}
      {!ended ? (
        <Composer
          draftKey={s.sessionId ? 'orbit.draft.' + s.sessionId : undefined}
          disabled={!live}
          placeholder={live ? 'Type a message…' : 'Connecting…'}
          maxChars={LIMITS.MESSAGE_MAX_CHARS}
          leadingAction={<SkipButton />}
          onSend={(t) => chatClient.sendMessage(t)}
          onTyping={(t) => chatClient.typing(t)}
        />
      ) : (
        <div className="flex gap-2 border-t border-border/60 px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6">
          <Button
            className="flex-1"
            size="lg"
            onClick={() => chatClient.start()}
            leftIcon={<SkipForward className="h-5 w-5" />}
          >
            New Stranger
          </Button>
          <Button size="lg" variant="secondary" onClick={() => chatClient.backToIdle()}>
            Done
          </Button>
        </div>
      )}

      <ReportDialog
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        subject={peerName}
        evidenceNote="The last few messages of this chat will be attached for moderators and deleted after 90 days."
        onSubmit={async (r) => {
          if (!ended && chatClient.report(r.reason, r.details, r.alsoBlock)) {
            toast({
              title: 'Report sent',
              body: 'Thank you. Our moderators will review it.',
              tone: 'success',
            });
            return;
          }
          if (!s.sessionId) throw new Error('This chat is no longer available.');
          await api('/api/reports', {
            method: 'POST',
            body: { ...r, context: 'random_chat', sessionId: s.sessionId },
          });
          toast({
            title: 'Report sent',
            body: 'Thank you. Our moderators will review it.',
            tone: 'success',
          });
        }}
      />
      <QuestPicker open={questOpen} onClose={() => setQuestOpen(false)} />
      <Dialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="End this chat?"
        description={`Your conversation with ${peerName} will end for both of you.`}
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
            Keep chatting
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmEnd(false);
              chatClient.end();
            }}
          >
            End chat
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirmBlock}
        onClose={() => setConfirmBlock(false)}
        title={`Block ${peerName}?`}
        description="The chat ends immediately, and you'll never be matched or contacted by them again."
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmBlock(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={block} loading={busy === 'block'}>
            Block
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function SkipButton() {
  const [armed, setArmed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  const reduce = useReducedMotion();

  const reset = () => {
    clearTimeout(resetTimer.current);
    setArmed(false);
  };

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const skip = () => {
    if (armed) {
      reset();
      chatClient.next();
      return;
    }
    setArmed(true);
    resetTimer.current = setTimeout(() => setArmed(false), 2400);
  };

  return (
    <motion.button
      type="button"
      layout={!reduce}
      onClick={skip}
      data-testid="next-stranger"
      aria-label={armed ? 'Confirm skip stranger' : 'Skip stranger'}
      aria-pressed={armed}
      className={cn(
        'relative h-[54px] w-[94px] shrink-0 overflow-hidden rounded-2xl border px-2 text-xs font-bold shadow-soft transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg sm:w-[108px] sm:text-sm',
        armed
          ? 'border-coral bg-coral text-white'
          : 'border-border bg-surface-2 text-fg hover:border-primary/50 hover:bg-surface-3',
      )}
    >
      <motion.span
        key={armed ? 'confirm' : 'skip'}
        initial={reduce ? false : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 flex items-center justify-center gap-1.5"
      >
        <SkipForward className="h-4 w-4 shrink-0" aria-hidden />
        <span>{armed ? 'Tap again' : 'Skip'}</span>
      </motion.span>
      {armed && (
        <motion.span
          className="absolute inset-x-0 bottom-0 h-1 origin-left bg-white/70"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: 2.4, ease: 'linear' }}
          aria-hidden
        />
      )}
    </motion.button>
  );
}
function SaveBanner() {
  const save = useChat((s) => s.save);
  const phase = useChat((s) => s.phase);
  if (phase !== 'matched' || save === 'none') return null;
  const body: Record<typeof save, React.ReactNode> = {
    requested_by_me: 'Waiting for the stranger to agree to save this conversation…',
    requested_by_peer: (
      <span className="flex flex-wrap items-center justify-center gap-2">
        The stranger wants to save this conversation to both your histories (kept 90 days).
        <Button size="sm" onClick={() => chatClient.respondSave(true)}>
          Allow
        </Button>
        <Button size="sm" variant="ghost" onClick={() => chatClient.respondSave(false)}>
          Decline
        </Button>
      </span>
    ),
    saved: 'Both of you agreed — this conversation will be saved to your History for 90 days.',
    declined: 'Saving was declined. Nothing from this chat will be kept.',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      role="status"
      className="border-b border-border/60 bg-accent/10 px-4 py-2 text-center text-xs font-medium"
    >
      {body[save]}
    </motion.div>
  );
}

function EndedBanner({
  peerName,
  onReport,
  onFriend,
}: {
  peerName: string;
  onReport: () => void;
  onFriend: () => void;
}) {
  const s = useChat();
  const text =
    s.endedBy === 'me'
      ? 'You ended the chat.'
      : s.endReason === 'timeout'
        ? `${peerName} lost connection.`
        : s.endReason === 'blocked'
          ? 'This chat was ended because of a block.'
          : s.endReason === 'moderation'
            ? 'This chat was ended by our safety system.'
            : s.endReason === 'expired'
              ? 'This chat expired.'
              : `${peerName} disconnected.`;
  return (
    <div className="my-6 rounded-2xl border border-border bg-surface p-4 text-center" role="status">
      <p className="font-bold">{text}</p>
      <p className="mt-1 text-xs text-muted">
        {s.save === 'saved'
          ? 'Conversation saved to your History.'
          : 'This conversation was not saved.'}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {s.friendRequest === 'none' && s.endReason !== 'blocked' && (
          <Button
            size="sm"
            variant="secondary"
            onClick={onFriend}
            leftIcon={<UserPlus className="h-4 w-4" />}
          >
            Send friend request
          </Button>
        )}
        {!s.reported && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onReport}
            leftIcon={<Flag className="h-4 w-4" />}
          >
            Report
          </Button>
        )}
        <Link
          to="/app/history"
          className="inline-flex h-9 items-center rounded-xl px-3 text-sm font-semibold text-muted hover:bg-surface-2"
        >
          View history
        </Link>
      </div>
    </div>
  );
}
