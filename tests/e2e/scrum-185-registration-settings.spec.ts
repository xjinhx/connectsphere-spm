import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, clientOrganisationId, daysFromToday, RUN, userId } from './support/data';

/**
 * SCRUM-185 AC5, AC6: the assigned coordinator sets a Confirmed event's
 * registration start date, end date and capacity on its registration page, and
 * a refused save names the field. Test case IDs match the SCRUM-185 tab of the
 * Sprint 4 sheet.
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

test('SCRUM-185 AC5 AC6 TC-185-01, TC-185-04, TC-185-05: the coordinator sets registration; refusals name the field', async ({ page }) => {
  await signIn(page, 'coordinator');
  await page.goto(`/events/${eventId}/review`);
  await page.getByRole('link', { name: 'Registration', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${eventId}/registrations$`));
  await expect(page.getByTestId('registration-capacity')).toHaveText('Not set');

  await page.getByRole('button', { name: 'Set registration' }).click();
  const start = page.getByLabel('Registration start date');
  const end = page.getByLabel('Registration end date');
  const capacity = page.getByLabel('Capacity');

  // TC-185-04: an end date before the start date names the end date.
  await start.fill(END);
  await end.fill(START);
  await capacity.fill('50');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Registration end date must be on or after the start date.')).toBeVisible();
  await expect(end).toHaveAttribute('aria-invalid', 'true');

  // TC-185-05: one more than the venue holds names capacity.
  await start.fill(START);
  await end.fill(END);
  await capacity.fill('301');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText("Capacity must be no more than 300, the largest capacity of this event's venues.")).toBeVisible();
  await expect(capacity).toHaveAttribute('aria-invalid', 'true');

  // TC-185-01: saved and shown on the registration page, after a reload too.
  await capacity.fill('250');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Registration saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('registration-startDate')).toHaveText(shown(START));
  await expect(page.getByTestId('registration-endDate')).toHaveText(shown(END));
  await expect(page.getByTestId('registration-capacity')).toHaveText('250');
});
