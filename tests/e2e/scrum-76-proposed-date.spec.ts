import { expect, test, type Page } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, RUN } from './support/data';

/**
 * SCRUM-76 TC-76-10 to TC-76-12: the proposed date's year, on the real form.
 *
 * AC4 (Jira): "Given a proposed date is in the future, when the Organiser
 * submits, then the request can be created - no minimum lead time applies."
 * Product Owner (SCRUM-257): 31 Dec 9999 is the latest valid date; 1 Jan 10000
 * and later are refused with "Choose a valid date." on the field.
 *
 * The defect: a browser date input takes a five- or six-digit year, the schema
 * accepted it, and Postgres then refused it, so the organiser saw a 400 "could
 * not be saved" carrying a raw database error, with the date field unmarked.
 * Two guards now stand in the way: the form does not take a year over four
 * digits (the field), and the server refuses one with "Choose a valid date."
 * (the API). The field is checked by typing; the server by posting the request
 * the form can no longer send.
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
 * event React listens to. Playwright's fill() refuses a year over four digits.
 */
async function enterDate(page: Page, value: string): Promise<void> {
  await page.getByLabel('Proposed date').evaluate((input: HTMLInputElement, next: string) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** The request the form sends on Save request / Save as draft, with the date as given. */
function requestBody(name: string, proposedDate: string) {
  return { name, purpose: 'Networking', description: 'Yearly gathering', proposedDate };
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

test('TC-76-11: the field takes no fifth digit of the year, and the server refuses one', async ({ page }) => {
  const name = `${NAME_PREFIX} five-digit`;
  await openNewRequest(page, name);

  // The field: type the year 2026 into the year segment, then a fifth digit.
  // Chrome keeps only the last four digits typed, never five.
  const date = page.getByLabel('Proposed date');
  await date.fill('2026-12-10');
  await date.click({ position: { x: 78, y: 18 } });
  for (const digit of ['2', '0', '2', '6', '6', '7']) await page.keyboard.press(digit);
  await expect(date).toHaveValue(/^\d{4}-12-10$/);
  // A five-digit year put in programmatically is not taken either.
  await date.fill('2026-12-10');
  await enterDate(page, '20266-12-10');
  await expect(date).toHaveValue('2026-12-10');

  // The server: the request the form can no longer send is refused on the field,
  // for a saved request and for a draft, with no raw database error.
  for (const path of ['/api/event-requests', '/api/event-requests/draft']) {
    const response = await page.request.post(path, { data: requestBody(name, '20266-12-10') });
    expect(response.status(), path).toBe(400);
    const body = await response.json();
    expect(body.details.fieldErrors.proposedDate, path).toEqual([CHOOSE_A_VALID_DATE]);
    expect(JSON.stringify(body), path).not.toMatch(/time zone displacement/i);
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

  // 1 Jan 10000: the field will not take it, and the server refuses it.
  await page.goto('/events/new');
  await enterDate(page, '10000-01-01');
  await expect(page.getByLabel('Proposed date')).toHaveValue('');
  const refused = `${NAME_PREFIX} first-five-digit`;
  const response = await page.request.post('/api/event-requests', { data: requestBody(refused, '10000-01-01') });
  expect(response.status()).toBe(400);
  expect((await response.json()).details.fieldErrors.proposedDate).toEqual([CHOOSE_A_VALID_DATE]);

  expect(await storedRequests(accepted)).toEqual([{ name: accepted, proposed_date: '9999-12-31' }]);
  expect(await storedRequests(refused)).toEqual([]);
});
