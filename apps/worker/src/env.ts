export interface Env {
  MATCH_COORDINATOR: DurableObjectNamespace;
  CHAT_ROOM: DurableObjectNamespace;

  SUPABASE_URL: string;
  /** Server-only. Never expose to the browser. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Optional: only for projects still on legacy HS256 JWT signing. */
  SUPABASE_JWT_SECRET?: string;
  /** HMAC secret used to sign short-lived room join tokens. */
  ROOM_TOKEN_SECRET: string;
  /** Comma-separated list of allowed browser origins. */
  CLIENT_ORIGIN: string;
  TURNSTILE_SECRET_KEY?: string;
  /** "true" to require Turnstile on realtime-ticket issuance for anonymous users. */
  REQUIRE_TURNSTILE?: string;
  APP_ENV?: 'development' | 'staging' | 'production' | 'test';
}
