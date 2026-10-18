/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_BASE_URL?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_ENABLE_TURNSTILE?: string;
  readonly VITE_APP_ENV?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
interface Window {
  turnstile?: {
    render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    execute: (id: string) => void;
    reset: (id: string) => void;
    remove: (id: string) => void;
  };
}
