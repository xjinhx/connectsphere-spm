import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';

/**
 * SCRUM-250 AC2 at phone width (TC-250-06): below 768 px the shared header
 * (SCRUM-249 AC6) folds the nav into a menu button, and the organiser's two
 * items appear inside it, in order. Needs only the seeded accounts.
 */

test('SCRUM-250 AC2 TC-250-06: at 390 px the organiser nav folds into the menu, in order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, 'organiser');
  await expect(page).toHaveURL(/\/events$/);

  // Since SCRUM-268 the login is a full page load, so a click can land before
  // the header hydrates and do nothing. Click until the menu opens, as the
  // SCRUM-268 tests do.
  const menuButton = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(async () => {
    if ((await menuButton.getAttribute('aria-expanded')) !== 'true') await menuButton.click();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  const menu = page.locator('#app-nav-menu');
  await expect(menu.getByRole('link')).toHaveText(['Event requests', 'New event request']);
  await expect(menu.getByRole('link', { name: 'Event requests' })).toHaveAttribute('aria-current', 'page');

  await menu.getByRole('link', { name: 'New event request' }).click();
  await expect(page).toHaveURL(/\/events\/new$/);
});
