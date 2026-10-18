# Talksy

**A random hello could become a great conversation.**

Talksy is a mobile-first, real-time, anonymous random **text** chat web app. It has guest and Google sign-in, gender-blind first-available matching, friends, persistent DMs, consent-based history, notifications, moderation, and **Conversation Quest**, a two-player icebreaker game.

| Layer | Tech |
|---|---|
| Web | React 18, TypeScript, Vite, Tailwind CSS, shadcn-style in-repo components, React Router, Zustand, TanStack Query, Lucide, Framer Motion |
| Realtime + API | Cloudflare Workers, Durable Objects (SQLite backend, hibernatable WebSockets) |
| Data + Auth | Supabase Postgres + RLS, Supabase Auth (anonymous + Google OAuth), Supabase Realtime |
| Hosting | Cloudflare Pages (web) and Workers (API) |
| Tests | Vitest, React Testing Library, Playwright, `@cloudflare/vitest-pool-workers`, pgTAP |

> Product name and colours live in `packages/shared/src/brand.ts`. You can also override the name with `VITE_APP_NAME`.

---

## Quick start (local)

**Prerequisites:** Node 20+, pnpm 9+, and a free Supabase project. The Supabase CLI is optional and only needed for local DB or pgTAP tests.

```bash
pnpm install

# 1) Database: apply migrations to your Supabase project
#    Option A (CLI):   supabase link --project-ref YOUR_PROJECT_REF && supabase db push
#    Option B (no CLI): paste supabase/migrations/*.sql in order into the Dashboard SQL editor

# 2) Configure env
cp apps/web/.env.example apps/web/.env
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
#    -> fill in Supabase URL, publishable key (web) and secret key (worker),
#       and set ROOM_TOKEN_SECRET (openssl rand -base64 48)

# 3) Supabase dashboard: Authentication -> enable Anonymous sign-ins
#    and Manual linking (needed for guest -> Google upgrade). See docs/setup.md.

# 4) Run web (5173) + worker (8787)
pnpm dev
```

Then open http://localhost:5173 in two different browsers (or one normal and one private window) and press **Start Chat** in both.

### Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server plus `wrangler dev` (Durable Objects run locally) |
| `pnpm build` | Typecheck all packages, then the production web build (`apps/web/dist`) and worker bundle (`apps/worker/dist`) |
| `pnpm test` | Unit and engine-level integration tests (shared, quest content, worker, web) |
| `pnpm --filter @orbit/worker test:integration` | Worker tests inside workerd with real DOs and WebSockets |
| `pnpm test:e2e` | Playwright against a running stack (`E2E_BASE_URL`) |
| `supabase test db` | pgTAP RLS and privilege tests (`supabase/tests`) |
| `pnpm deploy:worker` / `pnpm deploy:web` | Deploy to Cloudflare (see `docs/deployment.md`) |

## Repository layout

```
apps/web/            React app (pages, components, stores, services/chatClient.ts)
apps/worker/         Worker REST API + Durable Objects
  src/matchmaking/   engine.ts (pure FIFO matcher) + coordinator.ts (DO)
  src/rooms/         engine.ts (pure room/quest state machine) + room.ts (DO)
  src/routes/        REST handlers   src/auth/  JWT (JWKS) + room tokens
packages/shared/     Protocol types + validators, constants, API types, brand
packages/quest-content/  Conversation Quest question packs
supabase/migrations/ Schema, RLS, SQL functions, Realtime
supabase/tests/      pgTAP security tests
docs/                Architecture, setup, OAuth, deployment, security, DB, testing, moderation
```

## Documentation

- [Architecture](docs/architecture.md): components, matching algorithm, protocols, scaling and sharding plan
- [Local setup](docs/setup.md) and [environment checklist](docs/setup.md#environment-configuration-checklist)
- [Google OAuth setup](docs/oauth-setup.md)
- [Production deployment](docs/deployment.md)
- [Security notes](docs/security.md), [Database](docs/database.md), [Testing](docs/testing.md), [Moderation & launch readiness](docs/moderation.md)

## Important limitations (read before launch)

- **Age:** the 18+ checkbox is self-declared and does **not** verify age. See `docs/moderation.md` for what's needed before an unrestricted public launch.
- **Moderation:** automated heuristics (rate limits, flood/link detection, strike kicks) are basic. A public anonymous chat needs human moderators covering reports.
- **Cost:** the architecture fits free tiers for development and small launches. Real traffic will eventually need paid Cloudflare and Supabase plans, so don't assume worldwide hosting stays free.
- **Single global matchmaker:** one coordinator Durable Object. See the sharding strategy in `docs/architecture.md`.
- **Legal text** in `/terms`, `/privacy` and `/guidelines` is a template. Have it reviewed by a lawyer.
