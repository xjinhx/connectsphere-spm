import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';

/**
 * SCRUM-256 AC1 and AC2, end to end: a real sign-in as the seeded Safety
 * Officer lands on Safety checks, and the shared header's nav holds Safety
 * checks alone, highlighted. Needs only the seeded accounts.
 */

test('TC-256-01 / TC-256-06 / TC-256-07: a Safety Officer lands on Safety checks, the only nav item, highlighted', async ({ page }) => {
  await signIn(page, 'safetyOfficer');

  await expect(page).toHaveURL(/\/safety-checks$/);
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Safety checks']);
  await expect(nav.getByRole('link', { name: 'Safety checks' })).toHaveAttribute('aria-current', 'page');
});
