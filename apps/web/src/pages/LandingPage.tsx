import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowRight,
  Bookmark,
  Flag,
  Ghost,
  Globe2,
  Lock,
  MessageCircle,
  Shuffle,
  Sparkles,
  UserPlus,
  Zap,
} from 'lucide-react';
import { BRAND, LIMITS } from '@orbit/shared';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { usePresenceCount } from '@/hooks/queries';
import { useAuth } from '@/stores/authStore';
import { useUi } from '@/stores/uiStore';
import { env } from '@/lib/env';

const FEATURES = [
  {
    icon: Zap,
    title: 'Instant matching',
    body: 'One tap and you are paired with the first available person — no waiting rooms, no swiping.',
  },
  {
    icon: Shuffle,
    title: 'Truly random',
    body: 'Anyone can meet anyone. No gender filters, no paid boosts, no algorithmic sorting.',
  },
  {
    icon: Ghost,
    title: 'Anonymous by default',
    body: 'Chat with a nickname and a generated avatar. Your email is never shown to anyone.',
  },
  {
    icon: UserPlus,
    title: 'Keep the good ones',
    body: 'Hit it off? Send a friend request and continue in private DMs that persist.',
  },
  {
    icon: Bookmark,
    title: 'Save only with consent',
    body: 'Stranger chats vanish when they end — unless you both agree to save them.',
  },
  {
    icon: Flag,
    title: 'Safety built in',
    body: 'Report and block in one tap, non-clickable links, spam limits and human moderation.',
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const status = useAuth((s) => s.status);
  const setAuthOpen = useUi((s) => s.setAuthOpen);
  const presence = usePresenceCount();
  const reduce = useReducedMotion();
  const online = presence.data?.online ?? 0;

  const start = () =>
    status === 'signedIn'
      ? navigate('/app/chat', { state: { autoStart: true } })
      : setAuthOpen(true);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 top-40 h-[360px] w-[360px] rounded-full bg-coral/15 blur-3xl"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-[1.1fr_0.9fr] md:pb-24 md:pt-20">
          <div>
            {online > 0 && (
              <p
                className="mb-5 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-sm font-semibold text-success"
                aria-live="polite"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                ~{online.toLocaleString()} {online === 1 ? 'person' : 'people'} online now
              </p>
            )}
            <h1 className="text-balance text-4xl font-extrabold leading-[1.05] sm:text-5xl lg:text-6xl">
              A random hello could become a{' '}
              <span className="text-gradient">great conversation.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">{BRAND.description}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" onClick={start} className="text-base" data-testid="hero-start">
                Start Chatting <ArrowRight className="h-5 w-5" aria-hidden />
              </Button>
              <a
                href="#how"
                className="inline-flex h-14 items-center justify-center rounded-2xl border border-border px-6 font-semibold hover:bg-surface-2"
              >
                How It Works
              </a>
            </div>
            <p className="mt-4 text-sm text-muted">Free · No sign-up form · 18+ only</p>
          </div>

          {/* Illustrative mock (static preview, clearly decorative) */}
          <motion.div
            aria-hidden
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative mx-auto w-full max-w-sm"
          >
            <div className="rounded-3xl border border-border bg-surface p-4 shadow-2xl">
              <div className="flex items-center gap-3 border-b border-border pb-3">
                <Avatar seed="preview1" style="aurora" size={40} status="online" />
                <div>
                  <p className="text-sm font-bold">LunarOtter42</p>
                  <p className="text-xs text-success">Connected</p>
                </div>
              </div>
              <div className="space-y-2 py-4 text-sm">
                <div className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2">
                  hey! where in the world are you? 🌍
                </div>
                <div className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-brand-gradient px-3 py-2 text-primary-fg">
                  somewhere rainy ☔ you?
                </div>
                <div className="w-fit max-w-[80%] rounded-2xl rounded-bl-md bg-surface-2 px-3 py-2">
                  sunny side here. wanna play a quest?
                </div>
              </div>
              <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
                  🤔 Would You Rather
                </p>
                <p className="mt-1 text-sm font-semibold">
                  Travel anywhere for free or speak every language?
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-semibold">
                  <span className="rounded-xl bg-surface px-2 py-2 text-center">Travel free</span>
                  <span className="rounded-xl bg-surface px-2 py-2 text-center">
                    Every language
                  </span>
                </div>
              </div>
            </div>
            <p className="mt-2 text-center text-xs text-muted">Illustration</p>
          </motion.div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="scroll-mt-20 border-y border-border/60 bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-3xl font-extrabold">How it works</h2>
          <p className="mt-2 max-w-2xl text-muted">
            Random matching means the first available person is paired with you. Everyone is
            eligible — there are no gender, country or interest filters.
          </p>
          <ol className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                n: 1,
                t: 'Hop in',
                b: 'Continue as a guest or with Google. Pick a nickname — that is all.',
              },
              {
                n: 2,
                t: 'Get matched',
                b: 'Press Start. You will be paired with the next available person anywhere in the world.',
              },
              {
                n: 3,
                t: 'Chat, skip or befriend',
                b: 'Talk, play a Conversation Quest, hit Next for someone new, or add them as a friend.',
              },
            ].map((s) => (
              <li key={s.n} className="rounded-2xl border border-border bg-surface p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient font-extrabold text-primary-fg">
                  {s.n}
                </span>
                <h3 className="mt-4 font-bold">{s.t}</h3>
                <p className="mt-1 text-sm text-muted">{s.b}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-3xl font-extrabold">Made for real conversations</h2>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-border bg-surface p-5 transition hover:border-primary/40"
            >
              <f.icon className="h-6 w-6 text-primary" aria-hidden />
              <h3 className="mt-3 font-bold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Guest + Quest */}
      <section className="mx-auto grid max-w-6xl gap-5 px-4 pb-16 sm:px-6 md:grid-cols-2">
        <div className="rounded-3xl border border-border bg-surface p-6">
          <Ghost className="h-7 w-7 text-accent" aria-hidden />
          <h2 className="mt-3 text-2xl font-extrabold">Guest access in one tap</h2>
          <p className="mt-2 text-sm text-muted">
            Guests get a real, secure account that lives in this browser — with friends, DMs and
            history. Clearing browser data or switching devices can lose an unlinked guest account,
            so you can link Google anytime and keep everything.
          </p>
        </div>
        <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 to-accent/10 p-6">
          <Sparkles className="h-7 w-7 text-primary" aria-hidden />
          <h2 className="mt-3 text-2xl font-extrabold">Conversation Quest</h2>
          <p className="mt-2 text-sm text-muted">
            Not sure what to say? Invite your match to a quick game — This or That, Would You
            Rather, Two Truths and a Lie, Culture Exchange and more. You both answer, then reveal
            together. Optional, playful and free.
          </p>
        </div>
      </section>

      {/* Safety */}
      <section className="border-t border-border/60 bg-surface/40">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-[1fr_1.2fr]">
          <div>
            <Lock className="h-7 w-7 text-success" aria-hidden />
            <h2 className="mt-3 text-3xl font-extrabold">Safety & community</h2>
            <p className="mt-2 text-muted">
              {env.appName} is for adults 18+. Self-declared age can't guarantee who is on the other
              side, so we combine reporting, blocking, rate limits and human moderation.
            </p>
          </div>
          <ul className="grid gap-3 text-sm sm:grid-cols-2">
            {[
              'Be respectful — harassment and hate lead to bans.',
              'Never share personal info like address, school or phone.',
              'Links from strangers are never clickable.',
              'Report anyone who seems underage.',
              'Blocking stops matches, requests and DMs instantly.',
              `During testing, stranger chats may be reviewed and are deleted after ${LIMITS.TESTING_CHAT_RETENTION_DAYS} days.`,
            ].map((t) => (
              <li key={t} className="flex gap-2 rounded-2xl border border-border bg-surface p-3.5">
                <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <MessageCircle className="mx-auto h-10 w-10 text-primary" aria-hidden />
        <h2 className="mt-3 text-3xl font-extrabold">Someone out there wants to say hello.</h2>
        <Button size="lg" className="mt-6" onClick={start}>
          Start Chatting
        </Button>
      </section>
    </>
  );
}
