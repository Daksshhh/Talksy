import { defineConfig } from 'vitest/config';

// Unit + engine-level integration tests (pure TypeScript, run in Node).
export default defineConfig({
  test: {
    include: ['src/tests/**/*.test.ts'],
    environment: 'node',
  },
});
