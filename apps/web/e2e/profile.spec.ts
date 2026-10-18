import { test, expect } from '@playwright/test';
import { guestOnboard } from './helpers';

test('profile edits persist', async ({ page }) => {
  await guestOnboard(page, `Editor${Date.now() % 1000}`);
  await page.goto('/app/profile');
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Bio').fill('Loves stargazing ✨');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Loves stargazing ✨')).toBeVisible();
});
