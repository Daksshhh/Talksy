import { defineConfig, devices } from '@playwright/test';

/**
 * E2E tests run against a REAL stack (Supabase project with anonymous sign-ins
 * enabled + Worker). Set E2E_BASE_URL (default http://localhost:5173) and start
 * `pnpm dev` first, or point at a staging deployment.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-pixel', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
    { name: 'mobile-iphone', use: { ...devices['iPhone 13'] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
