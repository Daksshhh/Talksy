import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/stores/authStore';
import { useMe } from '@/hooks/queries';
import { FullPageSpinner } from './FullPageSpinner';
import { ErrorState } from '@/components/ui/Feedback';
import { errorMessage } from '@/lib/api';
import { chatClient } from '@/services/chatClient';

/** Gate: signed in -> profile loaded -> onboarding complete. Server enforces the same rules. */
export function RequireAuth({ children, allowNotOnboarded = false }: { children: ReactNode; allowNotOnboarded?: boolean }) {
  const status = useAuth((s) => s.status);
  const isAnonymous = useAuth((s) => s.isAnonymous);
  const loc = useLocation();
  const onboardedAtEntry = useRef<boolean | null>(null);
  const me = useMe();

  useEffect(() => chatClient.setAnonymous(isAnonymous), [isAnonymous]);

  if (status === 'loading') return <FullPageSpinner />;
  if (status === 'signedOut') return <Navigate to={`/?auth=1&next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.isLoading) return <FullPageSpinner />;
  if (me.isError || !me.data)
    return (
      <div className="grid min-h-[100dvh] place-items-center">
        <ErrorState title="We couldn't load your account" message={errorMessage(me.error)} onRetry={() => me.refetch()} />
      </div>
    );
  if (onboardedAtEntry.current === null) onboardedAtEntry.current = me.data.onboarded;
  if (!me.data.onboarded && !allowNotOnboarded) return <Navigate to={`/onboarding?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (onboardedAtEntry.current && allowNotOnboarded) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
