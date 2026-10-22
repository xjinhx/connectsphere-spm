import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, RUN } from './support/data';

/**
 * SCRUM-76 TC-76-10 to TC-76-12: the proposed date's year, on the real form.
 *
 * AC4 (Jira): "Given a proposed date is in the future, when the Organiser
 * submits, then the request can be created - no minimum lead time applies."
 *
 * The defect: a five-digit year (the date input accepts six digits) was taken
 * by the schema and then refused by Postgres, so the organiser saw a 400 "could
 * not be saved" carrying a raw database error, with the date field unmarked.
 * It should be refused on the Proposed date field with "Choose a valid date.".
 *
 * The date is entered with enterDate() below, because fill() refuses a year of
 * more than four digits. Requests are named with RUN and removed afterwards.
 */

const NAME_PREFIX = `E2E-76 ${RUN}`;
const CHOOSE_A_VALID_DATE = 'Choose a valid date.';

async function openNewRequest(page: Page, name: string): Promise<void> {
  await signIn(page, 'organiser');
  await page.goto('/events/new');
  await page.getByLabel('Event name').fill(name);
  await page.getByLabel('Purpose').fill('Networking');
  await page.getByLabel('Description').fill('Yearly gathering');
}

/**
 * Puts a value into the Proposed date input the way the browser reports one
 * (YYYY-MM-DD, with a year of any length up to six digits) and fires the input
 * event React listens to. Playwright's fill() refuses a year over four digits
 * and typing into Chrome's month/day/year segments is not reliable.
 */
async function enterDate(page: Page, value: string): Promise<void> {
  await page.getByLabel('Proposed date').evaluate((input: HTMLInputElement, next: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function storedRequests(namePrefix: string): Promise<{ name: string; proposed_date: string | null }[]> {
  const { data, error } = await admin()
    .from('event_request')
    .select('name, proposed_date')
    .like('name', `${namePrefix}%`);
  if (error) throw new Error(`could not read the stored requests: ${error.message}`);
  return data ?? [];
}

test.afterAll(async () => {
  await admin().from('event_request').delete().like('name', `${NAME_PREFIX}%`);
});

test('TC-76-10: a four-digit-year date is saved and shown unchanged', async ({ page }) => {
  const name = `${NAME_PREFIX} happy`;
  await openNewRequest(page, name);
  await enterDate(page, '2026-12-10');
  await expect(page.getByLabel('Proposed date')).toHaveValue('2026-12-10');

  await page.getByRole('button', { name: 'Save request' }).click();

  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByText('10 Dec 2026').first()).toBeVisible();
  expect(await storedRequests(name)).toEqual([{ name, proposed_date: '2026-12-10' }]);
});

test('TC-76-11: a five-digit year is refused on the Proposed date field, on save and on draft', async ({ page }) => {
  const name = `${NAME_PREFIX} five-digit`;
  await openNewRequest(page, name);
  await enterDate(page, '20266-12-10');
  await expect(page.getByLabel('Proposed date')).toHaveValue('20266-12-10');

  for (const button of ['Save request', 'Save as draft']) {
    await page.getByRole('button', { name: button }).click();

    // Marked on the field, not only as a banner, and no raw database error.
    await expect(page.getByRole('alert').filter({ hasText: CHOOSE_A_VALID_DATE })).toBeVisible();
    await expect(page.getByText(/time zone displacement/i)).toHaveCount(0);
    await expect(page).toHaveURL(/\/events\/new$/);
  }
  expect(await storedRequests(name)).toEqual([]);
});

test('TC-76-12: 31 Dec 9999 is accepted and 1 Jan 10000 is refused', async ({ page }) => {
  const accepted = `${NAME_PREFIX} last-date`;
  await openNewRequest(page, accepted);
  await enterDate(page, '9999-12-31');
  await expect(page.getByLabel('Proposed date')).toHaveValue('9999-12-31');
  await page.getByRole('button', { name: 'Save request' }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  await expect(page.getByText('31 Dec 9999').first()).toBeVisible();

  const refused = `${NAME_PREFIX} first-five-digit`;
  await page.goto('/events/new');
  await page.getByLabel('Event name').fill(refused);
  await page.getByLabel('Purpose').fill('Networking');
  await page.getByLabel('Description').fill('Yearly gathering');
  await enterDate(page, '10000-01-01');
  await expect(page.getByLabel('Proposed date')).toHaveValue('10000-01-01');
  await page.getByRole('button', { name: 'Save request' }).click();
  await expect(page.getByRole('alert').filter({ hasText: CHOOSE_A_VALID_DATE })).toBeVisible();

  expect(await storedRequests(accepted)).toEqual([{ name: accepted, proposed_date: '9999-12-31' }]);
  expect(await storedRequests(refused)).toEqual([]);
});
