import { expect, test, type Page } from '@playwright/test';
import { ACCOUNTS, signIn, TEST_PASSWORD } from './support/accounts';

/**
 * SCRUM-268 (bug on SCRUM-249): after signing out, the login page kept the last
 * account's header until a reload. None of these tests reloads the page: the
 * bug only showed on client-side navigation. Test case IDs match the SCRUM-268
 * tab of the test case sheet. Needs only the seeded accounts.
 */

async function logOut(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: `Account menu for ${email}` }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function expectNoHeader(page: Page): Promise<void> {
  await expect(page.getByRole('banner')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Account menu for / })).toHaveCount(0);
}

async function logInFromLoginPage(page: Page, email: string): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('TC-268-01: after Log out, the login page shows no header', async ({ page }) => {
  await signIn(page, 'coordinator');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  await logOut(page, ACCOUNTS.coordinator);

  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expectNoHeader(page);
});

test('TC-268-02: after an idle sign-out, the login page shows no header', async ({ page, context }) => {
  await signIn(page, 'coordinator');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  // Pretend the last request was 31 minutes ago (SCRUM-75 AC2 idle timeout).
  await context.addCookies([
    {
      name: 'csp_last_activity',
      value: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      url: page.url(),
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Assigned events' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  await expectNoHeader(page);
});

test('TC-268-03: the next account after Log out sees only its own header', async ({ page }) => {
  await signIn(page, 'coordinator');
  await logOut(page, ACCOUNTS.coordinator);

  await logInFromLoginPage(page, ACCOUNTS.techSupport);

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Equipment requests' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Assigned events' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Account menu for ${ACCOUNTS.techSupport}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Account menu for ${ACCOUNTS.coordinator}` })).toHaveCount(0);
});

test('TC-268-04: signing back in shows the full header again', async ({ page }) => {
  await signIn(page, 'coordinator');
  await logOut(page, ACCOUNTS.coordinator);

  await logInFromLoginPage(page, ACCOUNTS.coordinator);

  await expect(page).toHaveURL(/\/assigned-events$/);
  await expect(page.getByRole('link', { name: 'ConnectSphere' })).toHaveAttribute('href', '/assigned-events');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Assigned events' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: /Notifications/ })).toBeVisible();
  await expect(page.getByRole('button', { name: `Account menu for ${ACCOUNTS.coordinator}` })).toBeVisible();
});
