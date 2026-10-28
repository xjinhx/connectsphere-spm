import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, clientOrganisationId, daysFromToday, RUN, userId } from './support/data';

/**
 * SCRUM-185, through the real pages. AC5, AC6: the assigned coordinator sets a
 * Confirmed event's registration start date, end date and capacity on its
 * registration page, and a refused save names the field. AC1, AC2: the
 * coordinator sees the list and counts; the responsible organiser opens it from
 * their request page and exports it. AC3, AC4 (colleague, other organisation)
 * are in tests/integration/registration-list-view.test.ts. Test case IDs match
 * the SCRUM-185 tab of the Sprint 4 sheet.
 *
 * Starting data: a Confirmed event assigned to coordinator@example.com, with a
 * confirmed booking at a 300-capacity venue.
 */

const EVENT_NAME = `S185 E2E Harbour Gala ${RUN}`;
const VENUE_NAME = `S185 E2E Ballroom ${RUN}`;
const START = daysFromToday(5);
const END = daysFromToday(20);

let eventId: string;
let venueId: string;

/** DD/MM/YYYY, as the page shows a date. */
function shown(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

test.beforeAll(async () => {
  const coordinator = await userId('coordinator@example.com');
  const organiser = await userId('organiser@example.com');
  const date = daysFromToday(30);

  const { data: location } = await admin().from('locations').select('id').eq('name', 'Marina Bay').single();
  const { data: venue, error: venueError } = await admin().rpc('create_venue', {
    p_name: VENUE_NAME,
    p_location_id: location!.id,
    p_max_capacity: 300,
    p_operating_slots: ['am', 'pm', 'night'],
    p_facility_ids: [],
    p_accessibility_feature_ids: [],
    p_layouts: [{ layout: 'theatre', capacity: 300 }],
    p_opens_at: '07:00',
    p_closes_at: '24:00',
  });
  if (venueError) throw new Error(`could not create test venue: ${venueError.message}`);
  venueId = venue as string;

  const { data: event, error } = await admin()
    .from('event_request')
    .insert({
      name: EVENT_NAME,
      organiser_id: organiser,
      client_organisation_id: await clientOrganisationId(),
      purpose: 'Client gala',
      description: 'Gala dinner',
      proposed_date: date,
      start_time: '10:00',
      end_time: '12:00',
      expected_attendance: 150,
    })
    .select('id')
    .single();
  if (error || !event) throw new Error(`could not create test event: ${error?.message}`);
  eventId = event.id;

  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: coordinator },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
    { status: 'planning' },
  ]) {
    await admin().from('event_request').update(patch).eq('id', eventId);
  }
  await admin()
    .from('venue_booking')
    .insert({ venue_id: venueId, event_request_id: eventId, date, start_time: '10:00', end_time: '12:00', status: 'confirmed' });
  await admin().from('event_request').update({ status: 'confirmed' }).eq('id', eventId);
});

test.afterAll(async () => {
  // The event first: its booking goes with it (cascade).
  if (eventId) await admin().from('event_request').delete().eq('id', eventId);
  if (venueId) await admin().from('venues').delete().eq('id', venueId);
});

test('SCRUM-185 AC5 AC6 TC-185-08, TC-185-12, TC-185-13: the coordinator sets registration; refusals name the field', async ({ page }) => {
  await signIn(page, 'coordinator');
  await page.goto(`/events/${eventId}/review`);
  await page.getByRole('link', { name: 'Registration', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}/registrations$`));
  await expect(page.getByTestId('registration-capacity')).toHaveText('Not set');

  await page.getByRole('button', { name: 'Set registration' }).click();
  const start = page.getByLabel('Registration start date');
  const end = page.getByLabel('Registration end date');
  const capacity = page.getByLabel('Capacity');

  // TC-185-12: an end date before the start date names the end date.
  await start.fill(END);
  await end.fill(START);
  await capacity.fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Registration end date must be on or after the start date.')).toBeVisible();
  await expect(end).toHaveAttribute('aria-invalid', 'true');

  // TC-185-13: one more than the venue holds names capacity.
  await start.fill(START);
  await end.fill(END);
  await capacity.fill('301');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText("Capacity must be no more than 300, the largest capacity of this event's venues.")).toBeVisible();
  await expect(capacity).toHaveAttribute('aria-invalid', 'true');

  // TC-185-08: saved and shown on the registration page, after a reload too.
  await capacity.fill('250');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Registration saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('registration-startDate')).toHaveText(shown(START));
  await expect(page.getByTestId('registration-endDate')).toHaveText(shown(END));
  await expect(page.getByTestId('registration-capacity')).toHaveText('250');
});

test('SCRUM-185 AC1 AC2 TC-185-01, TC-185-04: the coordinator sees the list and counts; the organiser exports it', async ({ page }) => {
  // Registration open today with capacity 250, and attendee@ registered
  // through SCRUM-181's own function.
  const today = daysFromToday(0);
  await admin()
    .from('event_request')
    .update({ registration_start_date: today, registration_end_date: daysFromToday(14), registration_capacity: 250 })
    .eq('id', eventId);
  const { data: outcome } = await admin().rpc('register_for_event', {
    p_event_request_id: eventId,
    p_attendee_id: await userId('attendee@example.com'),
    p_full_name: 'Attendee One',
    p_email: 'attendee@example.com',
    p_contact_number: '+65 9123 4567',
    p_today: today,
  });
  expect(outcome).toBe('registered');

  // AC1: the assigned coordinator.
  await signIn(page, 'coordinator');
  await page.goto(`/events/${eventId}/registrations`);
  await expect(page.getByTestId('count-registered')).toHaveText('1');
  await expect(page.getByTestId('count-capacity')).toHaveText('250');
  await expect(page.getByTestId('count-remaining')).toHaveText('249');
  const row = page.getByRole('row', { name: /Attendee One/ });
  await expect(row).toContainText(shown(today));
  await expect(row).toContainText('Registered');
  await expect(page.getByRole('link', { name: 'Export' })).toHaveCount(0);

  // AC2: the responsible organiser reaches it from their request page and exports it.
  await signIn(page, 'organiser');
  await page.goto(`/events/${eventId}`);
  await page.getByRole('link', { name: 'Registration list' }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}/registrations$`));
  await expect(page.getByRole('row', { name: /Attendee One/ })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^registrations-EVT-\d{4}-\d{4}\.csv$/);
  const csv = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
  expect(csv).toContain('Attendee One,attendee@example.com');
  expect(csv).toContain(`${shown(today)},Registered`);
});
