import { test, expect } from '@playwright/test';
import { guestOnboard } from './helpers';

test('landing and app have no horizontal scroll on phones; bottom nav visible', async ({
  page,
}) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Start Chatting' }).first()).toBeVisible();
  await guestOnboard(page, `Mobile${Date.now() % 1000}`, '/app/profile');
  await page.goto('/app/profile');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Log out of Talksy?' })).toBeVisible();
  await page.getByRole('button', { name: 'Stay logged in' }).click();
  await expect(page).toHaveURL(/\/app\/profile/);

  await page.goto('/app');
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).last()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});
