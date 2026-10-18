import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { FullPageSpinner } from '@/components/layout/FullPageSpinner';
import { ErrorState } from '@/components/ui/Feedback';
import { Button } from '@/components/ui/Button';

function safeNext(next: string | null): string {
  // Only allow same-site relative paths (prevents open redirects).
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
}

/** OAuth (PKCE) return URL. supabase-js exchanges ?code= automatically (detectSessionInUrl). */
export default function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const err = params.get('error_description') || hash.get('error_description') || params.get('error');
    if (err) {
      const code = params.get('error_code') || hash.get('error_code');
      setError(
        code === 'identity_already_exists'
          ? 'That Google account is already linked to another Talksy account. Sign out and sign in with Google to use it — your current guest data stays on this guest account.'
          : err,
      );
      return;
    }
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      navigate(safeNext(params.get('next')), { replace: true });
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION')) go();
    });
    supabase.auth.getSession().then(({ data: d }) => d.session && go());
    const t = setTimeout(() => !done && setError('Sign-in did not complete. Please try again.'), 12_000);
    return () => {
      clearTimeout(t);
      data.subscription.unsubscribe();
    };
  }, [params, navigate]);

  if (error)
    return (
      <div className="grid min-h-[100dvh] place-items-center px-4">
        <div className="max-w-md">
          <ErrorState title="Sign-in failed" message={error} />
          <div className="flex justify-center">
            <Link to="/?auth=1">
              <Button>Back to sign in</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  return <FullPageSpinner />;
}
