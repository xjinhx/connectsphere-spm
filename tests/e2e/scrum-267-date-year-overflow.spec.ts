import { expect, test, type Locator, type Page } from '@playwright/test';
import { signIn } from './support/accounts';

/**
 * SCRUM-267 (bug on SCRUM-76, 150, 151, 227, 239): typing an extra digit into a
 * date input's year ran the year on to 20261 and beyond (up to 275760). With
 * max set, the browser keeps the year to four digits. The venue search and
 * calendar need no data beyond the seeded venues and accounts; the other fields
 * are checked by tests/unit/date-input-max.test.ts. Test case IDs match the
 * SCRUM-267 tab of the test case sheet.
 */

// Fixes the segment order to MM/DD/YYYY, so the keys below land where expected.
test.use({ locale: 'en-US' });

/** Types 28/11/2026 and then one more year digit, as a fast typist would. */
async function typeDateWithExtraYearDigit(input: Locator): Promise<string> {
  await input.focus();
  await input.page().keyboard.type('112820261');
  return input.inputValue();
}

function expectFourDigitYear(value: string): void {
  expect(value).not.toMatch(/^\d{5,}-/);
}

async function openCalendar(page: Page): Promise<void> {
  await page.goto('/venues');
  await page.getByRole('link', { name: 'Marina Bay Ballroom' }).first().click();
  await page.getByRole('link', { name: 'View calendar' }).click();
  await expect(page).toHaveURL(/\/calendar/);
}

test('TC-267-05: the venue search Date keeps the year to four digits', async ({ page }) => {
  await signIn(page, 'coordinator');
  await page.goto('/venues/search');

  expectFourDigitYear(await typeDateWithExtraYearDigit(page.getByLabel('Date', { exact: true })));
});

test('TC-267-06: the venue calendar From and To keep the year to four digits', async ({ page }) => {
  await signIn(page, 'coordinator');
  await openCalendar(page);

  expectFourDigitYear(await typeDateWithExtraYearDigit(page.getByLabel('From', { exact: true })));
  expectFourDigitYear(await typeDateWithExtraYearDigit(page.getByLabel('To', { exact: true })));
});

test('TC-267-08: 31/12/9999 is still accepted in the venue search Date', async ({ page }) => {
  await signIn(page, 'coordinator');
  await page.goto('/venues/search');

  const date = page.getByLabel('Date', { exact: true });
  await date.focus();
  await page.keyboard.type('12319999');
  await expect(date).toHaveValue('9999-12-31');

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/date=9999-12-31/);
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('9999-12-31');
});
