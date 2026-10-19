import { test, expect } from '@playwright/test';
import { matchPair, twoGuests } from './helpers';

test('two browser contexts match, exchange messages and two-tap Skip ends the session', async ({
  browser,
}) => {
  const { pa, pb, ctxA, ctxB } = await twoGuests(browser);
  await matchPair(pa, pb);
  await expect(pa.getByTestId('match-found')).toBeVisible();
  await expect(pb.getByTestId('match-found')).toBeVisible();

  await pa.getByLabel('Message').fill('Hello from A 👋');
  await pa.keyboard.press('Enter');
  await expect(pb.getByText('Hello from A 👋')).toBeVisible();

  await pb.getByLabel('Message').fill('Hi A — नमस्ते');
  await pb.keyboard.press('Enter');
  await expect(pa.getByText('Hi A — नमस्ते')).toBeVisible();

  // typing indicator
  await pb.getByLabel('Message').pressSequentially('typing...');
  await expect(pa.getByText(/is typing/)).toBeVisible();

  await pa.getByTestId('next-stranger').click();
  await expect(pa.getByTestId('next-stranger')).toContainText('Tap again');
  await expect(pb.getByText('Connected', { exact: true })).toBeVisible();
  await pa.getByTestId('next-stranger').click();
  await expect(pb.getByText(/disconnected/)).toBeVisible();
  await expect(pa.getByText('Finding someone to chat with…')).toBeVisible();
  await pa.getByRole('button', { name: 'Cancel Search' }).click();
  await ctxA.close();
  await ctxB.close();
});

test('friend request -> accept -> DM persists after reload; history shows the chat', async ({
  browser,
}) => {
  const { pa, pb, ctxA, ctxB } = await twoGuests(browser, 'Frienda', 'Friendb');
  await matchPair(pa, pb);
  await pa.getByRole('button', { name: 'More actions' }).click();
  await pa.getByRole('menuitem', { name: 'Add friend' }).click();
  await expect(pa.getByText('Friend request sent')).toBeVisible();

  await pb.goto('/app/friends?tab=incoming');
  await pb.getByRole('button', { name: 'Accept' }).click();
  await expect(pb.getByText(/now friends/)).toBeVisible();

  await pb.goto('/app/inbox');
  await pb
    .getByRole('link')
    .filter({ hasText: /Frienda/ })
    .first()
    .click();
  await pb.getByLabel('Message').fill('persistent hello');
  await pb.keyboard.press('Enter');
  await expect(pb.getByText('persistent hello')).toBeVisible();
  await pb.reload();
  await expect(pb.getByText('persistent hello')).toBeVisible();

  await pa.goto('/app/history');
  await expect(pa.getByText(/Friendb/).first()).toBeVisible();
  await ctxA.close();
  await ctxB.close();
});

test('blocking ends the chat and prevents re-matching', async ({ browser }) => {
  const { pa, pb, ctxA, ctxB } = await twoGuests(browser, 'Blocker', 'Blocked');
  await matchPair(pa, pb);
  await pa.getByRole('button', { name: 'More actions' }).click();
  await pa.getByRole('menuitem', { name: 'Block' }).click();
  await pa.getByRole('button', { name: 'Block', exact: true }).click();
  await expect(pb.getByText(/ended|disconnected/)).toBeVisible();
  await pa.getByRole('button', { name: 'New Stranger' }).click();
  await pb.getByRole('button', { name: 'New Stranger' }).click();
  // Both keep searching instead of being paired with each other.
  await pa.waitForTimeout(3000);
  await expect(pa.getByText('Finding someone to chat with…')).toBeVisible();
  await ctxA.close();
  await ctxB.close();
});
