import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Browser Supabase client. Uses the publishable (anon) key only — all access is
 * constrained by Row Level Security. Sessions persist in localStorage and refresh
 * automatically; PKCE is used for OAuth redirects.
 */
export const supabase = createClient(env.supabaseUrl || 'http://invalid.local', env.supabaseKey || 'invalid', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
    storageKey: 'talksy.auth',
  },
  realtime: { params: { eventsPerSecond: 10 } },
});
