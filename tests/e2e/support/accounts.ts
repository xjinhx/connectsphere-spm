import { expect, type Page } from '@playwright/test';

/**
 * The accounts scripts/seed-auth-users.mjs creates, one per role, all with the
 * same password. They exist only in the local Supabase stack.
 */
export const ACCOUNTS = {
  organiser: 'organiser@example.com',
  coordinator: 'coordinator@example.com',
  lead: 'ops-manager@example.com',
  venueStaff: 'venue-staff@example.com',
  techSupport: 'tech-support@example.com',
  attendee: 'attendee@example.com',
  safetyOfficer: 'safety-officer@example.com',
} as const;

export type Account = keyof typeof ACCOUNTS;

export const TEST_PASSWORD = 'TestPass123!';

/**
 * Signs in through the login page, as a user would, and waits until the app has
 * moved on from it. Ends any earlier session first, so one test can switch
 * between roles (e.g. a coordinator requests, Venue Staff approve).
 */
export async function signIn(page: Page, account: Account): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(ACCOUNTS[account]);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
