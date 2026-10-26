import { expect, test, type Page } from '@playwright/test';
import { signIn, TEST_PASSWORD } from './support/accounts';
import { admin, clientOrganisationId, RUN } from './support/data';

/**
 * SCRUM-76 TC-76-01, TC-76-02, TC-76-03 and TC-76-09, on the real pages.
 *
 *   AC1 "... when the request is saved, then it is stored with those values and
 *        appears in the Organiser's event list."
 *   AC7 "Given a logged-in Organiser linked to a client organisation, when they
 *        choose to create an event request, then a blank request form opens with
 *        their client organisation pre-filled."
 *   AC8 "Given a logged-in Organiser not linked to any client organisation, when
 *        they attempt to create an event request, then they are blocked and told
 *        to contact their Event Coordinator to get linked first."
 *
 * Two Organiser accounts are made here, one linked and one not, so the test does
 * not depend on how the seeded organiser@example.com happens to be set up. They
 * and their requests are removed afterwards.
 *
 * Known gap, not asserted here: AC8 is enforced on the event list (no create
 * link, the message is shown). The New event request page and the save itself
 * still work for an unlinked Organiser (docs/dummies.md D-01), so TC-76-09 is
 * checked from the list, the way the test case words it.
 */

const NAME = `E2E-76 create ${RUN}`;
const ORGANISATION_NAME = 'End-to-end Test Organisation';
const accounts = {
  linked: { email: `e2e-76-linked-${RUN}@example.com`, id: '' },
  unlinked: { email: `e2e-76-unlinked-${RUN}@example.com`, id: '' },
};

async function createOrganiser(email: string, clientOrganisation: string | null): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
  const { error: profileError } = await admin()
    .from('profiles')
    .update({ roles: ['event_organiser'], full_name: 'E2E Organiser', client_organisation_id: clientOrganisation })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set up ${email}: ${profileError.message}`);
  return data.user.id;
}

async function logIn(page: Page, email: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.beforeAll(async () => {
  accounts.linked.id = await createOrganiser(accounts.linked.email, await clientOrganisationId());
  accounts.unlinked.id = await createOrganiser(accounts.unlinked.email, null);
});

test.afterAll(async () => {
  for (const { id } of Object.values(accounts)) {
    if (!id) continue;
    await admin().from('event_request').delete().eq('organiser_id', id);
    await admin().auth.admin.deleteUser(id);
  }
});

test('TC-76-01: a signed-out visitor and a non-Organiser cannot reach the New event request form', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/events/new');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('Event name')).toHaveCount(0);

  await signIn(page, 'coordinator');
  await page.goto('/events/new');
  await expect(page.getByText('Access denied')).toBeVisible();
  await expect(page.getByLabel('Event name')).toHaveCount(0);
});

test('TC-76-02: a linked Organiser opens a blank request with their client organisation pre-filled', async ({ page }) => {
  await logIn(page, accounts.linked.email);
  await page.goto('/events');
  await page.getByRole('link', { name: 'Create an event request' }).click();
  await expect(page).toHaveURL(/\/events\/new$/);

  await expect(page.getByLabel('Client organisation')).toHaveValue(ORGANISATION_NAME);
  for (const label of ['Event name', 'Purpose', 'Description', 'Proposed date']) {
    await expect(page.getByLabel(label), label).toHaveValue('');
  }
});

test('TC-76-03: a saved request keeps its details, gets a reference and appears in the Organiser\'s list', async ({ page }) => {
  await logIn(page, accounts.linked.email);
  await page.goto('/events/new');
  await page.getByLabel('Event name').fill(NAME);
  await page.getByLabel('Purpose').fill('Networking');
  await page.getByLabel('Description').fill('Yearly gathering');
  await page.getByLabel('Proposed date').fill('2026-11-15');
  await page.getByRole('button', { name: 'Save request' }).click();

  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  const main = page.locator('main');
  await expect(main).toContainText(NAME);
  await expect(main).toContainText('Networking');
  await expect(main).toContainText('Yearly gathering');
  await expect(main).toContainText('15 Nov 2026');
  await expect(main).toContainText(/EVT-\d{4}-\d{4,}/);

  await page.goto('/events');
  await expect(page.getByRole('link', { name: new RegExp(NAME) })).toBeVisible();
});

test('TC-76-09: an Organiser with no client organisation is told to get linked, with no way to create a request', async ({ page }) => {
  await logIn(page, accounts.unlinked.email);
  await page.goto('/events');

  await expect(
    page.getByText(
      'Your account is not yet linked to a client organisation. Contact your Event Coordinator to get linked before creating or viewing event requests.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create an event request' })).toHaveCount(0);
});
