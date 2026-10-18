# Local setup

## 1. Install
```bash
node -v   # 20+
corepack enable && corepack prepare pnpm@9.12.3 --activate
pnpm install
```

## 2. Create a Supabase project
1. https://supabase.com → **New project** (free tier is fine).
2. **Settings → API Keys**: copy the **Project URL**, the **publishable key** (`sb_publishable_…`) and a **secret key** (`sb_secret_…`).
   - If your project shows only the legacy *anon* and *service_role* JWT keys, those work too. The legacy anon key goes in `VITE_SUPABASE_PUBLISHABLE_KEY` and the legacy service_role key goes in `SUPABASE_SERVICE_ROLE_KEY`. Supabase is retiring the legacy keys, so switch to the new keys when you can.
3. **Authentication → Sign In / Providers**:
   - Enable **Anonymous sign-ins** (required for guests).
   - Enable **Manual linking** (in Auth settings; needed for guest → Google upgrade).
   - Configure **Google** later (see `oauth-setup.md`). Guests work without it.
4. **Authentication → URL Configuration**: Site URL `http://localhost:5173`. Add `http://localhost:5173/auth/callback` to Redirect URLs.
5. Optional: **Authentication → Attack Protection → CAPTCHA**, choose Turnstile and paste the Turnstile **secret**. Then set `VITE_ENABLE_TURNSTILE=true` and the site key in the web env.
6. Recommended: **Authentication → JWT Keys**. Migrate to asymmetric signing keys (ES256/RS256). The Worker then verifies tokens locally via JWKS with no extra network call.

## 3. Apply the database
```bash
# With the CLI
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```
Without the CLI, open **SQL Editor** and run the files in `supabase/migrations/` **in filename order**.

The Realtime migration adds `direct_messages`, `notifications`, `friend_requests`, `direct_conversation_members` and `friendships` to the `supabase_realtime` publication. It also creates policies on `realtime.messages` for private DM typing channels.

## 4. Environment files
```bash
cp apps/web/.env.example apps/web/.env
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
openssl rand -base64 48   # paste as ROOM_TOKEN_SECRET
```

## 5. Run
```bash
pnpm dev            # web :5173 + worker :8787
```
Open two different browsers or profiles (one guest each) and press Start Chat in both.

## 6. Make yourself a moderator
Sign in once (with Google, so you can recover the account), then run this in the SQL editor:
```sql
insert into public.admin_roles (user_id, role)
select id, 'admin' from auth.users where email = 'you@example.com'
on conflict (user_id) do update set role = excluded.role;
```
Visit `/admin`.

---

## Environment configuration checklist

| Value | Where it goes | Secret? |
|---|---|---|
| `VITE_SUPABASE_URL` | `apps/web/.env`, Pages build vars | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable or legacy anon) | `apps/web/.env`, Pages build vars | No (public by design; RLS protects data) |
| `VITE_API_BASE_URL` / `VITE_WS_BASE_URL` | `apps/web/.env`, Pages build vars | No |
| `VITE_APP_URL`, `VITE_APP_NAME`, `VITE_APP_ENV` | `apps/web/.env`, Pages build vars | No |
| `VITE_TURNSTILE_SITE_KEY`, `VITE_ENABLE_TURNSTILE` | `apps/web/.env`, Pages build vars | No |
| `SUPABASE_URL` | `apps/worker/.dev.vars`, Worker secret | No |
| `SUPABASE_SERVICE_ROLE_KEY` (secret `sb_secret_…` or legacy service_role) | `.dev.vars`, **`wrangler secret put`** | **Yes. Never in `VITE_*`** |
| `SUPABASE_JWT_SECRET` (legacy HS256 projects only, optional) | `.dev.vars`, `wrangler secret put` | **Yes** |
| `ROOM_TOKEN_SECRET` | `.dev.vars`, `wrangler secret put` | **Yes** |
| `TURNSTILE_SECRET_KEY` | `.dev.vars`, `wrangler secret put`, and Supabase CAPTCHA settings | **Yes** |
| `CLIENT_ORIGIN`, `APP_ENV`, `REQUIRE_TURNSTILE` | `wrangler.toml` `[env.*].vars` | No |
| Google Client ID / Secret | **Supabase Dashboard → Auth → Google** only | Secret: yes |
| Authorized redirect URI `https://REF.supabase.co/auth/v1/callback` | **Google Cloud Console** | No |
| Site URL + Redirect URLs (`…/auth/callback`) | **Supabase → Auth → URL Configuration** | No |
| Anonymous sign-ins, Manual linking | **Supabase → Auth settings** | No |
