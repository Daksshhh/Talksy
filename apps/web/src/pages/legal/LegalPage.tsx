import { useEffect, type ReactNode } from 'react';
import { BRAND, LIMITS } from '@orbit/shared';
import { env } from '@/lib/env';

/**
 * Policy templates. IMPORTANT: these are starting points written to match how the
 * software actually behaves. Have them reviewed by a qualified lawyer for your
 * jurisdiction(s) before public launch, and fill in the operator details.
 */
type Doc = 'terms' | 'privacy' | 'guidelines' | 'contact' | 'report';

const H = ({ children }: { children: ReactNode }) => <h2 className="mt-8 text-xl font-bold">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="mt-3 text-muted">{children}</p>;
const UL = ({ items }: { items: ReactNode[] }) => <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;

const DOCS: Record<Doc, { title: string; body: ReactNode }> = {
  terms: {
    title: 'Terms of Service',
    body: (
      <>
        <P>Version {BRAND.termsVersion}. Operator: {BRAND.legalEntity}. By using {env.appName} you agree to these terms.</P>
        <H>Eligibility</H>
        <P>You must be at least 18 years old. Do not use the service if you are under 18. We may suspend accounts we reasonably believe belong to minors.</P>
        <H>Your conduct</H>
        <P>You must follow the Community Guidelines. You are responsible for what you send. Don't harass, threaten, spam, impersonate, share sexual content, or share others' personal information.</P>
        <H>Accounts</H>
        <P>Guest accounts are tied to your browser storage. If you clear it or switch devices without linking Google, you may permanently lose access to that guest account.</P>
        <H>Moderation</H>
        <P>We may review reports, remove access, suspend or ban accounts that violate these terms, and cooperate with lawful requests from authorities.</P>
        <H>Service</H>
        <P>The service is provided “as is”, is currently free, and may change or be discontinued. We do not guarantee availability or that you will be matched.</P>
        <H>Contact</H>
        <P>{BRAND.supportEmail}</P>
      </>
    ),
  },
  privacy: {
    title: 'Privacy Policy',
    body: (
      <>
        <P>This policy describes what the software stores. Operator: {BRAND.legalEntity}. Contact: {BRAND.privacyEmail}.</P>
        <H>What we store</H>
        <UL
          items={[
            'Account: an authentication ID; for Google sign-in, your Google identity/email is held by our auth provider and never shown to other users.',
            'Profile: nickname, generated avatar, optional bio, interests, language, gender (private unless you choose to show it), privacy and notification settings.',
            `Random chats: during initial testing, message text, session identifiers, sender identifiers and nickname snapshots are stored for up to ${LIMITS.TESTING_CHAT_RETENTION_DAYS} days so the operator can review how the service is used. Access is restricted to the operator.`,
            `Saved conversations: only when BOTH participants agree. Kept for ${LIMITS.SAVED_TRANSCRIPT_RETENTION_DAYS} days or until both participants remove access.`,
            'Direct messages between friends: stored until deleted with your account. “Delete my copy” hides messages for you.',
            `Reports: your reason and notes, plus minimal evidence (up to the last ${LIMITS.REPORT_EVIDENCE_MESSAGES} messages of a live random chat, or the single reported DM). Evidence is deleted after ${LIMITS.REPORT_EVIDENCE_RETENTION_DAYS} days.`,
            `Random-chat metadata is deleted after ${LIMITS.RANDOM_HISTORY_RETENTION_DAYS} days.`,
            'Operational logs avoid message content, tokens and IP addresses; user IDs are truncated.',
          ]}
        />
        <H>What we never do</H>
        <UL items={['Use gender or profile data for matching.', 'Sell your data or show ads in V1.', 'Show your email to other users.']} />
        <H>Your rights</H>
        <P>You can export your data and delete your account from your Profile at any time. Deleting your account removes your profile, friendships, DMs you sent and history. Moderation records about abuse may be retained where legally permitted.</P>
        <H>Processors</H>
        <P>Supabase (database & authentication), Cloudflare (hosting, realtime, bot protection), Google (optional sign-in).</P>
      </>
    ),
  },
  guidelines: {
    title: 'Community Guidelines',
    body: (
      <>
        <P>{env.appName} works when people are kind. Breaking these rules can lead to suspension or a permanent ban.</P>
        <UL
          items={[
            'Adults only (18+). Report anyone who appears to be a minor.',
            'No harassment, bullying, hate speech or threats.',
            'No sexual content, sexual requests or explicit messages.',
            'No spam, scams, advertising or link flooding.',
            'Never share — or pressure others to share — personal info (real name, address, school, phone, socials).',
            'Don\'t impersonate staff or other people.',
            'Respect “no”: if someone skips, declines a quest or a friend request, move on.',
          ]}
        />
        <P>Use Report and Block freely — they are anonymous to the other person.</P>
      </>
    ),
  },
  contact: {
    title: 'Contact',
    body: (
      <>
        <P>General support: {BRAND.supportEmail}</P>
        <P>Privacy & data requests: {BRAND.privacyEmail}</P>
        <P>Abuse & safety: {BRAND.abuseEmail}</P>
      </>
    ),
  },
  report: {
    title: 'Report Abuse',
    body: (
      <>
        <P>The fastest way to report is inside the app: use the menu in a chat, a direct message, or a History entry and choose Report. Reports go straight to our moderation queue.</P>
        <P>If you can't use the app, email {BRAND.abuseEmail} with the date/time and the nickname involved. Don't send screenshots of private information about others.</P>
        <P>If someone is in immediate danger, contact your local emergency services first.</P>
      </>
    ),
  },
};

export default function LegalPage({ doc }: { doc: Doc }) {
  const d = DOCS[doc];
  useEffect(() => {
    document.title = `${d.title} — ${env.appName}`;
  }, [d.title]);
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">{d.title}</h1>
      {d.body}
      <p className="mt-10 rounded-xl bg-surface-2 p-3 text-xs text-muted">Template text — the operator must review it with legal counsel before public launch.</p>
    </article>
  );
}
