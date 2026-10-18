import { BRAND } from '@orbit/shared';

function req(name: string, value: string | undefined): string {
  if (!value || value.includes('YOUR_')) {
    // Fail loudly in dev; surface a friendly screen in prod (see ConfigError in App).
    console.error(`[config] Missing ${name}. Copy apps/web/.env.example to apps/web/.env and fill it in.`);
    return '';
  }
  return value.replace(/\/$/, '');
}

export const env = {
  appName: import.meta.env.VITE_APP_NAME || BRAND.name,
  appUrl: (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, ''),
  supabaseUrl: req('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
  supabaseKey: req('VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
  apiBase: req('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL),
  wsBase: req('VITE_WS_BASE_URL', import.meta.env.VITE_WS_BASE_URL),
  turnstileSiteKey: import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined,
  turnstileEnabled: import.meta.env.VITE_ENABLE_TURNSTILE === 'true',
  appEnv: (import.meta.env.VITE_APP_ENV || 'development') as string,
};

export const configOk = !!(env.supabaseUrl && env.supabaseKey && env.apiBase && env.wsBase);
