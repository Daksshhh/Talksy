import { test, expect } from '@playwright/test';
import { guestOnboard } from './helpers';

test('guest onboarding and returning guest keep the same identity', async ({ page }) => {
  const name = `Returning${Date.now() % 10000}`;
  await guestOnboard(page, name);
  await page.goto('/app/profile');
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name })).toBeVisible(); // session persisted
  await page.goto('/');
  await page.getByRole('link', { name: 'Open app' }).click();
  await expect(page).toHaveURL(/\/app/);
});

test('Google button starts a real OAuth redirect via Supabase', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).click();
  const [req] = await Promise.all([
    page.waitForRequest((r) => /\/auth\/v1\/authorize\?provider=google/.test(r.url()) || /accounts\.google\.com/.test(r.url())),
    page.getByRole('button', { name: 'Continue with Google' }).click(),
  ]);
  expect(req.url()).toMatch(/google/);
  // Completing Google login needs real test credentials; see docs/testing.md.
});
