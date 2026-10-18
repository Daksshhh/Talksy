# Testing

| Suite | Command | Needs |
|---|---|---|
| Shared validation & protocol | `pnpm --filter @orbit/shared test` | nothing |
| Quest content | `pnpm --filter @orbit/quest-content test` | nothing |
| Worker unit + engine integration (matchmaking acceptance tests, room/quest/save/report flows, JWT, tokens, rate limits) | `pnpm --filter @orbit/worker test` | nothing |
| Worker in workerd (real DOs + WebSockets: origin check, ticket reuse, match, messaging, Next, blocks) | `pnpm --filter @orbit/worker test:integration` | nothing (Miniflare) |
| Web unit (reducer, Composer, SafeText) | `pnpm --filter @orbit/web test` | nothing |
| DB security (pgTAP: RLS, forged inserts, privilege escalation, cross-user reads) | `supabase start && supabase test db` | Supabase CLI + Docker |
| E2E (guest onboarding, returning guest, Google redirect, two-context matching, messaging, Next, friends, DMs persist, history, profile, blocking, mobile viewports) | `pnpm dev` then `pnpm test:e2e` | running stack, anonymous sign-ins enabled |

### Matchmaking acceptance tests → `apps/worker/src/tests/matchmaking.test.ts`
Covers all 14 required cases (M+F, M+M, F+F, F+M, non-binary, guest + registered, Google + Google, three users with no duplicates, no self-match, blocked pairs, disconnected removal, Next requeue, 101 simultaneous joins with no double assignment, refresh during grace). It also includes a source scan proving the engine never references gender.

### Google OAuth in E2E
The E2E suite checks that the Google button starts a real Supabase `/authorize?provider=google` redirect. Completing Google login automatically needs a dedicated Google test account in a controlled environment. Google blocks scripted sign-ins, so the full round trip is verified manually per `oauth-setup.md` §7–8.

### Performance
Targets are documented but **not measured in this repository**. Measure with Lighthouse (landing page, mobile profile) and with Worker analytics for message latency. Don't treat the targets as achieved until you've measured them.
