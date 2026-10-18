import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  userId: string | null;
  isAnonymous: boolean;
}

export const useAuth = create<AuthState>(() => ({ status: 'loading', session: null, userId: null, isAnonymous: false }));

function apply(session: Session | null) {
  useAuth.setState({
    status: session ? 'signedIn' : 'signedOut',
    session,
    userId: session?.user.id ?? null,
    isAnonymous: session?.user.is_anonymous === true,
  });
  if (session) supabase.realtime.setAuth(session.access_token);
}

let started = false;
/** Subscribe to Supabase auth once; returns an unsubscribe function. */
export function startAuth(onSignedOut: () => void): () => void {
  if (started) return () => undefined;
  started = true;
  supabase.auth.getSession().then(({ data }) => apply(data.session));
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    apply(session);
    if (event === 'SIGNED_OUT') onSignedOut();
  });
  return () => {
    data.subscription.unsubscribe();
    started = false;
  };
}

export async function signInAsGuest(captchaToken?: string) {
  const { error } = await supabase.auth.signInAnonymously(captchaToken ? { options: { captchaToken } } : undefined);
  if (error) throw error;
}

export function callbackUrl(next = '/app') {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithGoogle(next = '/app') {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: callbackUrl(next), queryParams: { prompt: 'select_account' } },
  });
  if (error) throw error;
}

/** Upgrade a guest: link Google to the SAME user id so friends/history are kept. */
export async function linkGoogle() {
  const { error } = await supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo: callbackUrl('/app/profile?linked=1') } });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
