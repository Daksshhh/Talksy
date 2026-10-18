import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ghost, Info, ShieldCheck } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { useUi } from '@/stores/uiStore';
import { signInAsGuest, signInWithGoogle } from '@/stores/authStore';
import { env } from '@/lib/env';
import { getTurnstileToken } from '@/lib/turnstile';
import { errorMessage } from '@/lib/api';

export function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1S8.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

export function AuthDialog() {
  const open = useUi((s) => s.authOpen);
  const setOpen = useUi((s) => s.setAuthOpen);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/app/chat';
  const [busy, setBusy] = useState<'guest' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guest = async () => {
    setBusy('guest');
    setError(null);
    try {
      let captcha: string | undefined;
      if (env.turnstileEnabled) captcha = await getTurnstileToken('guest_signin');
      await signInAsGuest(captcha);
      setOpen(false);
      navigate(`/onboarding?next=${encodeURIComponent(next)}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const google = async () => {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle(next); // full-page redirect
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Join the conversation" description="Pick how you'd like to start. It takes seconds.">
      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={guest} loading={busy === 'guest'} disabled={!!busy} leftIcon={<Ghost className="h-5 w-5" />} data-autofocus>
          Continue as Guest
        </Button>
        <Button size="lg" variant="outline" className="w-full" onClick={google} loading={busy === 'google'} disabled={!!busy} leftIcon={<GoogleIcon />}>
          Continue with Google
        </Button>
        <p className="text-center text-xs text-muted">
          Already have an account? <button className="font-semibold text-primary hover:underline" onClick={google} disabled={!!busy}>Sign in with Google</button>
        </p>
        {error && (
          <p role="alert" className="rounded-xl bg-danger/10 p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2.5 rounded-2xl bg-surface-2/70 p-3.5 text-xs text-muted">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <p>
            <strong className="text-fg">Guest accounts</strong> live in this browser. Clearing browser data or switching devices can make an unlinked guest account
            unrecoverable. You can link Google later from your profile and keep your friends and history.
          </p>
        </div>
        <div className="flex gap-2.5 px-1 text-xs text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          <p>
            {env.appName} is for adults 18+. Your email is never shown to other users. Email/password accounts are not available yet.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
