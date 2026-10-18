import { test, expect } from '@playwright/test';
import { guestOnboard } from './helpers';

test('landing and app have no horizontal scroll on phones; bottom nav visible', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Start Chatting' }).last()).toBeVisible();
  await guestOnboard(page, `Mobile${Date.now() % 1000}`);
  await page.goto('/app');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
