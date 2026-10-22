import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, clientOrganisationId, daysFromToday, RUN, userId, venueId } from './support/data';

/**
 * E2E-229: replace a venue that fell through (SCRUM-229, Jira). One journey
 * through all four ACs, across two roles:
 * AC1 the coordinator starts a request for another venue from the affected
 *     booking, with its date and times filled in;
 * AC2 on a Confirmed event it is created and the event is not cancelled;
 * AC3 while it is pending, the affected booking is unchanged;
 * AC4 once Venue Staff approve it, the affected booking shows as replaced and
 *     its outstanding action is closed.
 *
 * Starting point (beforeAll): a Confirmed event with a booking at Bugis Seminar
 * Room, 10:15-11:45, and Bugis marked unavailable 10:00-11:00, so the booking is
 * affected. Everything after that is done on the pages.
 */

const DATE = daysFromToday(60);
const EVENT_NAME = `E2E-229 Event ${RUN}`;
let eventId: string;
let unavailablePeriodId: string;

async function eventStatus(): Promise<string> {
  const { data, error } = await admin().from('event_request').select('status').eq('id', eventId).single();
  if (error || !data) throw new Error(`could not read the event: ${error?.message}`);
  return data.status as string;
}

test.beforeAll(async () => {
  const db = admin();
  const organiserId = await userId('organiser@example.com');
  const coordinatorId = await userId('coordinator@example.com');
  const bugisId = await venueId('Bugis Seminar Room');

  const { data: event, error } = await db
    .from('event_request')
    .insert({
      organiser_id: organiserId,
      client_organisation_id: await clientOrganisationId(),
      name: EVENT_NAME,
      proposed_date: DATE,
      start_time: '10:15',
      end_time: '11:45',
      expected_attendance: 80,
    })
    .select('id')
    .single();
  if (error || !event) throw new Error(`could not create the event: ${error?.message}`);
  eventId = event.id;

  // The way the earlier stories move it: submitted, assigned, approved, Planning, Confirmed.
  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinatorId, assigned_by: coordinatorId },
    { status: 'approved', decision: 'approved', decided_by: coordinatorId },
    { status: 'planning' },
    { status: 'confirmed' },
  ]) {
    const { error: stepError } = await db.from('event_request').update(patch).eq('id', eventId);
    if (stepError) throw new Error(`could not prepare the event: ${stepError.message}`);
  }

  const { error: bookingError } = await db
    .from('venue_booking')
    .insert({ event_request_id: eventId, venue_id: bugisId, date: DATE, start_time: '10:15', end_time: '11:45' });
  if (bookingError) throw new Error(`could not create the booking: ${bookingError.message}`);

  const { data: period, error: periodError } = await db
    .from('venue_unavailable_slot')
    .insert({ venue_id: bugisId, date: DATE, start_time: '10:00', end_time: '11:00', reason: 'Ceiling leak' })
    .select('id')
    .single();
  if (periodError || !period) throw new Error(`could not mark Bugis unavailable: ${periodError?.message}`);
  unavailablePeriodId = period.id;
});

test.afterAll(async () => {
  // The event first: its requests, lines and bookings go with it (cascade).
  if (eventId) await admin().from('event_request').delete().eq('id', eventId);
  if (unavailablePeriodId) await admin().from('venue_unavailable_slot').delete().eq('id', unavailablePeriodId);
});

test('E2E-229: an approved replacement shows the affected booking as Replaced and closes its action', async ({ page }) => {
  const outstandingAction = page.getByText('Outstanding action: a venue booking is affected');

  // AC1: the coordinator starts a replacement from the affected booking.
  await signIn(page, 'coordinator');
  await page.goto(`/events/${eventId}/review`);
  await expect(outstandingAction).toBeVisible();
  await page.getByRole('button', { name: 'Request a replacement venue' }).click();

  await expect(page.getByLabel('Date', { exact: true })).toHaveValue(DATE);
  await expect(page.getByLabel('Start time', { exact: true })).toHaveValue('10:15');
  await expect(page.getByLabel('End time', { exact: true })).toHaveValue('11:45');
  // "Another venue": the one that fell through is not offered.
  const venue = page.getByLabel('Venue', { exact: true });
  await expect(venue.locator('option', { hasText: 'Bugis Seminar Room' })).toHaveCount(0);

  // AC2: on a Confirmed event, the request is created and the event is not cancelled.
  await venue.selectOption({ label: 'Marina Bay Ballroom' });
  await page.getByRole('button', { name: 'Request venue' }).click();
  await expect(page.getByText(/Venue booking request submitted/)).toBeVisible();
  expect(await eventStatus()).toBe('confirmed');

  // AC3: while it is pending, the affected booking and its action are unchanged.
  await page.reload();
  await expect(outstandingAction).toBeVisible();

  // AC4: Venue Staff approve it from their queue...
  await signIn(page, 'venueStaff');
  await page.goto('/booking-queue');
  await page.getByRole('row').filter({ hasText: EVENT_NAME }).getByRole('link', { name: 'Open' }).click();
  await page.getByRole('radio', { name: 'Approve' }).check();
  await page.getByRole('button', { name: 'Confirm decision' }).click();
  // Saved once the line shows its decision (the button only changes to "Saving...").
  await expect(page.getByText(/Approved by/)).toBeVisible();

  // ...and the coordinator sees the old booking Replaced, with its action closed.
  await signIn(page, 'coordinator');
  await page.goto(`/events/${eventId}/review`);
  await expect(outstandingAction).toHaveCount(0);
  const bookings = page.getByRole('region', { name: 'Venue bookings' });
  await expect(bookings.getByText('Replaced', { exact: true })).toBeVisible();
  await expect(bookings.getByText('Reason: Replaced by Marina Bay Ballroom')).toBeVisible();
  expect(await eventStatus()).toBe('confirmed');
});
