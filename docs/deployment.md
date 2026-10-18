# Production deployment

Nothing here has been deployed for you. These are the exact steps to run with your own accounts.

## A. Supabase
1. Create the project (pick a region near most users) and complete `setup.md` steps 2–3.
2. Apply the migrations: `npx supabase link --project-ref REF && npx supabase db push`.
3. Check that RLS is enabled on every table: **Database → Tables** should show "RLS enabled" everywhere. The migrations enable it.
4. **Realtime**: confirm the publication contains the five tables (Database → Publications → `supabase_realtime`). In Realtime settings, keep private channels authorised by RLS (the migration adds the `realtime.messages` policies).
5. **Auth**: enable Anonymous sign-ins, Manual linking and Google. Set Site URL and Redirect URLs to your production origin. Optionally enable CAPTCHA (Turnstile).
6. Operational settings: enable Point-in-Time Recovery or backups as your plan allows, set the Auth rate limits (anonymous sign-ins per hour per IP), and turn on leaked-password protection if you add email auth later.

## B. Cloudflare Worker + Durable Objects
```bash
cd apps/worker
npx wrangler login
# Set CLIENT_ORIGIN in wrangler.toml [env.production].vars to your Pages URL/custom domain first.
npx wrangler secret put SUPABASE_URL --env production
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production   # sb_secret_… (or legacy service_role)
npx wrangler secret put ROOM_TOKEN_SECRET --env production           # openssl rand -base64 48
npx wrangler secret put TURNSTILE_SECRET_KEY --env production        # optional
npx wrangler secret put SUPABASE_JWT_SECRET --env production         # only for legacy HS256 projects
pnpm deploy           # = wrangler deploy --env production (creates DO classes via the v1 migration)
```
The output gives you `https://orbitchat-api.<account>.workers.dev`. Your API base is that URL, and the WebSocket base is the same host with `wss://`.

Custom domain (optional): add the `routes` line in `wrangler.toml` (`api.yourdomain.com`, `custom_domain = true`). HTTPS/WSS certificates are automatic.

The cron trigger (daily 03:17 UTC) runs `purge_expired_data()` for retention.

## C. Cloudflare Pages (frontend)
Option 1, Git integration: **Workers & Pages → Create → Pages → Connect repository**
- Build command: `pnpm install && pnpm --filter @orbit/web build`
- Build output: `apps/web/dist`
- Root directory: `/`
- Environment variables (Production):
  ```
  VITE_APP_NAME=OrbitChat
  VITE_APP_URL=https://chat.yourdomain.com
  VITE_SUPABASE_URL=https://REF.supabase.co
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
  VITE_API_BASE_URL=https://api.yourdomain.com
  VITE_WS_BASE_URL=wss://api.yourdomain.com
  VITE_APP_ENV=production
  VITE_ENABLE_TURNSTILE=false
  NODE_VERSION=20
  ```

Option 2, direct upload: `cd apps/web && pnpm build && npx wrangler pages deploy dist --project-name orbitchat`. Env vars are read at build time from `apps/web/.env.production`.

`public/_redirects` provides SPA routing and `public/_headers` sets the security headers and CSP. **Edit `connect-src` in `_headers`** to your real API and Supabase domains.

## D. Wire everything together
1. Worker `CLIENT_ORIGIN` must exactly match the Pages origin(s), comma-separated, with no trailing slash. Redeploy the worker after changing it.
2. Supabase Redirect URLs must include `https://<pages-origin>/auth/callback`.
3. Google authorized JavaScript origins must include the Pages origin.

## E. Post-deployment verification (do all of these on desktop and on a phone)
- [ ] Landing page loads; `GET <api>/api/health` returns `{ok:true}`
- [ ] Guest login, then onboarding, then `/app/chat`
- [ ] Google login (new and returning user); token refresh after more than 1 hour
- [ ] Two devices match and exchange live messages both ways; typing indicator works
- [ ] Next: the peer sees "disconnected"; the skipper gets re-queued
- [ ] Refresh mid-chat restores the chat within 30s
- [ ] Friend request, accept, DM, reload, DM still there
- [ ] Profile edits persist; History shows the session; consented save shows a transcript
- [ ] Block ends the chat and you aren't re-matched; Report appears in `/admin`
- [ ] Logout, then login; account deletion removes the user
- [ ] Worker logs (`pnpm --filter @orbit/worker tail`) show no `api_exception`

## Cost notes (not free forever)
Free tiers are enough for development and a small soft launch. Durable Object duration and rows written grow with active chats (each message is about 2 storage writes in the room). Supabase Realtime connections and database size grow with users. Expect to move to the Workers Paid plan and a Supabase Pro plan as traffic grows.
