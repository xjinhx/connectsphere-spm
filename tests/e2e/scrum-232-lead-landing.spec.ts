import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';

/**
 * SCRUM-232 AC1 (Jira): "send a Lead to the unassigned queue at login". The
 * smallest end-to-end check: a real sign-in, through the login page, landing
 * where the role should. Needs no data beyond the seeded accounts.
 */

test('SCRUM-232 AC1: an Event Coordinator Lead lands on the assignment queue after signing in', async ({ page }) => {
  await signIn(page, 'lead');

  await expect(page).toHaveURL(/\/assignment-queue$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Assignment queue' })).toBeVisible();
});
