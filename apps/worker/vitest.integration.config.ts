import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Runs inside workerd with real Durable Objects + WebSockets (Miniflare).
// Supabase is pointed at an unreachable URL; DB side effects are best-effort and logged.
export default defineWorkersConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            SUPABASE_URL: 'http://127.0.0.1:9',
            SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
            ROOM_TOKEN_SECRET: 'test-room-secret-test-room-secret',
            CLIENT_ORIGIN: 'http://localhost:5173',
            APP_ENV: 'test',
          },
        },
      },
    },
  },
});
