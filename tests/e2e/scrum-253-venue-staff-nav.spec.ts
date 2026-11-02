import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, clientOrganisationId, daysFromToday, RUN, userId, venueId } from './support/data';

/**
 * SCRUM-253 Venue Staff Navigation. Test case IDs match the SCRUM-253 tab of
 * the Sprint 4 test case sheet.
 *
 * AC1 a Venue Staff account lands on /booking-queue on login.
 * AC2 (unit-tested in tests/unit/venue-staff-nav.test.ts — the header itself).
 * AC3 opening a Booking requests row opens /venue-booking-requests/[id] with
 *     a back link to Booking requests.
 * AC4 the Venues page links to Add venue; opening a venue opens /venues/[id]
 *     with links to Edit and Calendar, each with a back link to the venue.
 */

const EVENT_NAME = `SCRUM-253 Event ${RUN}`;
const DATE = daysFromToday(90);
let eventId: string;

test.beforeAll(async () => {
  const db = admin();
  const organiserId = await userId('organiser@example.com');
  const coordinatorId = await userId('coordinator@example.com');
  const venue = await venueId('Marina Bay Ballroom');

  const { data: event, error } = await db
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: await clientOrganisationId(),
      name: EVENT_NAME,
      proposed_date: DATE,
      start_time: '09:00',
      end_time: '10:00',
      expected_attendance: 40,
    })
    .select('id')
    .single();
  if (error || !event) throw new Error(`could not create the event: ${error?.message}`);
  eventId = event.id;

  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
    { status: 'planning' },
  ]) {
    const { error: stepError } = await db.from('event_request').update(patch).eq('id', eventId);
    if (stepError) throw new Error(`could not prepare the event: ${stepError.message}`);
  }

  // Same RPC the "request a venue" flow calls (create_venue_booking_request,
  // 20261006090000_venue_booking_request.sql / 20261012090000's time-range version).
  const { error: requestError } = await db.rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venue,
    p_requested_by: coordinatorId,
    p_lines: [{ date: DATE, start: '09:00', end: '10:00' }],
  });
  if (requestError) throw new Error(`could not seed the booking request: ${requestError.message}`);
});

test.afterAll(async () => {
  if (eventId) await admin().from('event_request').delete().eq('id', eventId);
});

test('SCRUM-253 AC1: a Venue Staff account lands on the booking queue after signing in', async ({ page }) => {
  await signIn(page, 'venueStaff');

  await expect(page).toHaveURL(/\/booking-queue$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Pending booking requests' })).toBeVisible();
});

test('SCRUM-253 AC3: opening a booking-queue row opens the request page with a back link', async ({ page }) => {
  await signIn(page, 'venueStaff');
  await page.goto('/booking-queue');

  const row = page.getByRole('row').filter({ hasText: EVENT_NAME });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/venue-booking-requests\/.+/);

  const back = page.getByRole('link', { name: 'Back to Booking requests' });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(/\/booking-queue$/);
});

test('SCRUM-253 AC4: Venues links to Add venue, and a venue links to Edit and Calendar with back links', async ({
  page,
}) => {
  await signIn(page, 'venueStaff');
  await page.goto('/venues');

  await expect(page.getByRole('link', { name: 'Add venue' })).toBeVisible();

  await page.getByRole('link', { name: 'Marina Bay Ballroom' }).click();
  await expect(page).toHaveURL(/\/venues\/.+/);
  const venuePageUrl = page.url();

  await page.getByRole('link', { name: 'Edit venue' }).click();
  await expect(page).toHaveURL(/\/venues\/.+\/edit/);
  await page.getByRole('link', { name: /Back to/ }).click();
  await expect(page).toHaveURL(venuePageUrl);

  await page.getByRole('link', { name: 'View calendar' }).click();
  await expect(page).toHaveURL(/\/venues\/.+\/calendar/);
  await page.getByRole('link', { name: 'Back to venue' }).click();
  await expect(page).toHaveURL(venuePageUrl);
});
