import { Link } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { env } from '@/lib/env';

const LINKS = [
  { to: '/terms', label: 'Terms' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/guidelines', label: 'Community Guidelines' },
  { to: '/contact', label: 'Contact' },
  { to: '/report-abuse', label: 'Report Abuse' },
];

export function Footer() {
  return (
    <footer className="border-t border-border/60 pb-safe">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Logo />
          <p className="mt-2 max-w-xs text-sm text-muted">Anonymous text chat for adults (18+). Be kind. Stay safe.</p>
        </div>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="text-muted hover:text-fg">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="pb-6 text-center text-xs text-muted">© {new Date().getFullYear()} {env.appName}. Free forever in V1 — no ads, no paywalls.</p>
    </footer>
  );
}
