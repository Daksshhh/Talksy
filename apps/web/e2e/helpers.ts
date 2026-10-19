import { expect, type Browser, type Page } from '@playwright/test';

/** Guest sign-in + onboarding through the real UI. */
export async function guestOnboard(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Preferred language').selectOption('en');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel(/18 years or older/).check();
  await page.getByLabel(/I accept the/).check();
  await page.getByRole('button', { name: 'Start chatting' }).click();
  await expect(page).toHaveURL(/\/app\/chat/);
}

export async function twoGuests(browser: Browser, a = 'AlphaTester', b = 'BravoTester') {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pa = await ctxA.newPage();
  const pb = await ctxB.newPage();
  await guestOnboard(pa, `${a}${Date.now() % 1000}`);
  await guestOnboard(pb, `${b}${Date.now() % 1000}`);
  return { pa, pb, ctxA, ctxB };
}

export async function matchPair(pa: Page, pb: Page) {
  await expect(pa.getByText('Finding someone to chat with…')).toBeVisible();
  await expect(pa.getByText('Connected', { exact: true })).toBeVisible();
  await expect(pb.getByText('Connected', { exact: true })).toBeVisible();
}
