import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';

/**
 * SCRUM-251 Event Coordinator Navigation: the real sign-in, header and venue
 * pages. Needs no data beyond the seeded accounts and venues. Test case IDs
 * match the SCRUM-251 tab of the Sprint 4 sheet.
 */

const NAV = ['Review queue', 'My events', 'Venues', 'Client organisations', 'Equipment'];

test('SCRUM-251 AC1 TC-251-01: an Event Coordinator lands on Review queue after signing in', async ({ page }) => {
  await signIn(page, 'coordinator');

  await expect(page).toHaveURL(/\/assigned-events$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Review queue' })).toBeVisible();
});

test('SCRUM-251 AC2 TC-251-02: the nav shows the five items in order, and each opens its page highlighted', async ({ page }) => {
  await signIn(page, 'coordinator');
  const nav = page.getByRole('navigation', { name: 'Main' });

  await expect(nav.getByRole('link')).toHaveText(NAV);

  for (const [label, path] of [
    ['My events', '/my-events'],
    ['Venues', '/venues'],
    ['Client organisations', '/organisations'],
    ['Equipment', '/equipment'],
    ['Review queue', '/assigned-events'],
  ] as const) {
    await nav.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(nav.locator('[aria-current="page"]')).toHaveText([label]);
  }
});

test('SCRUM-251 AC5 TC-251-10: Venues offers Search and Catalogue, and a venue links to its calendar', async ({ page }) => {
  await signIn(page, 'coordinator');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Venues', exact: true }).click();

  await page.getByRole('link', { name: 'Search by date and time' }).click();
  await expect(page).toHaveURL(/\/venues\/search$/);
  await page.getByRole('link', { name: 'Back to catalogue' }).click();
  await expect(page).toHaveURL(/\/venues$/);

  await page.getByRole('link', { name: 'Marina Bay Ballroom' }).click();
  await expect(page).toHaveURL(/\/venues\/[0-9a-f-]+$/);
  await page.getByRole('link', { name: 'View calendar' }).click();
  await expect(page).toHaveURL(/\/venues\/[0-9a-f-]+\/calendar/);
});
