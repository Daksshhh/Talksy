# Verification performed while building this repository

The build environment had **no package-registry access**, so `pnpm install`, `vite build`, `wrangler`, Playwright and the workerd integration suite could **not** be run there. Everything that doesn't need third-party packages was executed:

| Check | Result |
|---|---|
| Unit/engine tests (shared, quest-content, worker engines/auth/tokens/db, web chat reducer) executed with Node 24 + TypeScript via a minimal Vitest-compatible runner | **82 passed, 0 failed** |
| `tsc --strict` on `packages/shared`, `packages/quest-content`, `apps/worker/src` (Cloudflare types stubbed) | **0 errors** |
| `tsc` on `apps/web/src` with third-party modules stubbed as `any` | 0 errors in project code (only stub-induced implicit-any diagnostics) |

Run these on your machine after `pnpm install`:
```bash
pnpm typecheck && pnpm test
pnpm --filter @orbit/worker test:integration
pnpm --filter @orbit/web build
supabase test db          # pgTAP, needs Supabase CLI + Docker
pnpm dev & pnpm test:e2e  # needs configured Supabase project
```
The SQL migrations were written for Supabase Postgres 15+ but weren't executed against a live database in the build environment. Run `supabase db push` (or `supabase start`) and `supabase test db` first.
