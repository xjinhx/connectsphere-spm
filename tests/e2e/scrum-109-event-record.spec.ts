import { expect, test } from '@playwright/test';
import { signIn } from './support/accounts';
import { admin, clientOrganisationId, daysFromToday, RUN, userId } from './support/data';

/**
 * SCRUM-109, through the real pages: the assigned coordinator opens the full
 * record from their event page and sees every section (AC1); Venue Staff see
 * only theirs, with no heading for the rest (AC2); the Lead sees the essential
 * arrangements with nothing to change them (AC3). The other roles and the
 * refusals are in tests/integration/event-record.test.ts. Test case IDs match
 * the SCRUM-109 tab of the Sprint 4 sheet.
 *
 * Starting data: a Confirmed event assigned to coordinator@example.com, booked
 * through a request Venue Staff approved, with Projector P-100 × 2 reserved,
 * registration set, internal notes recorded and venue and equipment essential.
 */

const EVENT_NAME = `S109 E2E Harbour Gala ${RUN}`;
const VENUE_NAME = `S109 E2E Ballroom ${RUN}`;
const ITEM_NAME = `S109 E2E Projector ${RUN}`;

const SECTIONS = ['Assigned coordinator', 'Internal information', 'Venue arrangement', 'Equipment arrangement', 'Registration setting', 'Essential arrangements'];

let eventId: string;
let venueId: string;
let itemId: string;

test.beforeAll(async () => {
  const coordinator = await userId('coordinator@example.com');
  const organiser = await userId('organiser@example.com');
  const venueStaff = await userId('venue-staff@example.com');
  const techSupport = await userId('tech-support@example.com');
  const date = daysFromToday(60);

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

  const { data: item, error: itemError } = await admin()
    .from('equipment')
    .insert({ name: ITEM_NAME, category: 'av', quantity: 10, current_location: 'Bugis store room', created_by: techSupport })
    .select('id')
    .single();
  if (itemError || !item) throw new Error(`could not create test item: ${itemError?.message}`);
  itemId = item.id;

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
      registration_required: true,
    })
    .select('id')
    .single();
  if (error || !event) throw new Error(`could not create test event: ${error?.message}`);
  eventId = event.id;
  for (const patch of [
    { status: 'submitted' },
    { coordinator_id: coordinator, assigned_by: coordinator },
    { status: 'approved', decision: 'approved', decided_by: coordinator },
  ]) {
    await admin().from('event_request').update(patch).eq('id', eventId);
  }

  const { data: requestId } = await admin().rpc('create_venue_booking_request', {
    p_event_request_id: eventId,
    p_venue_id: venueId,
    p_requested_by: coordinator,
    p_lines: [{ date, start: '10:00', end: '12:00' }],
  });
  const { data: line } = await admin().from('venue_booking_request_line').select('id').eq('request_id', requestId).single();
  await admin().rpc('decide_venue_booking_request', {
    p_request_id: requestId,
    p_decisions: [{ line_id: line!.id, decision: 'approve', reason: null, suggestion: null }],
    p_decided_by: venueStaff,
  });

  await admin().from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' });
  const { data: equipmentLine } = await admin()
    .from('equipment_request_line')
    .insert({ event_request_id: eventId, equipment_id: itemId, quantity: 2, created_by: coordinator })
    .select('id')
    .single();
  await admin().from('equipment_reservation').insert({ line_id: equipmentLine!.id, quantity: 2, reserved_by: techSupport });

  await admin().rpc('record_essential_arrangements', {
    p_event_request_id: eventId,
    p_recorded_by: coordinator,
    p_venue: true,
    p_equipment: true,
    p_technical_support: false,
    p_registration: false,
  });
  await admin()
    .from('event_request')
    .update({
      internal_notes: 'VIP table near stage',
      status: 'confirmed',
      registration_start_date: daysFromToday(0),
      registration_end_date: daysFromToday(14),
      registration_capacity: 250,
    })
    .eq('id', eventId);
});

test.afterAll(async () => {
  // The event first: its booking, lines and reservation go with it (cascade).
  if (eventId) await admin().from('event_request').delete().eq('id', eventId);
  if (itemId) await admin().from('equipment').delete().eq('id', itemId);
  if (venueId) await admin().from('venues').delete().eq('id', venueId);
});

test('SCRUM-109 AC1 TC-109-01: the coordinator opens the full record from the event and sees every section', async ({ page }) => {
  await signIn(page, 'coordinator');
  await page.goto(`/events/${eventId}/review`);
  await page.getByRole('link', { name: 'Full event record →' }).click();

  await expect(page).toHaveURL(new RegExp(`/events/${eventId}/record$`));
  await expect(page.getByRole('heading', { level: 1, name: EVENT_NAME })).toBeVisible();
  for (const name of ['Event details', ...SECTIONS]) await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  await expect(page.getByText(`${ITEM_NAME} × 2`)).toBeVisible();
});

test('SCRUM-109 AC2 TC-109-06: Venue Staff see the coordinator and the venue, and no heading for the rest', async ({ page }) => {
  await signIn(page, 'venueStaff');
  await page.goto(`/events/${eventId}/record`);

  await expect(page.getByRole('heading', { level: 2, name: 'Assigned coordinator' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Venue arrangement' })).toBeVisible();
  for (const name of ['Internal information', 'Equipment arrangement', 'Registration setting', 'Essential arrangements']) {
    await expect(page.getByRole('heading', { level: 2, name })).toHaveCount(0);
  }
  await expect(page.getByText('VIP table near stage')).toHaveCount(0);
});

test('SCRUM-109 AC3 TC-109-12, TC-109-13: the Lead sees each essential arrangement complete, with nothing to change it', async ({ page }) => {
  await signIn(page, 'lead');
  await page.goto(`/events/${eventId}/record`);

  const essential = page.getByRole('region', { name: 'Essential arrangements' });
  await expect(essential.getByRole('listitem')).toHaveText([/Venue\s*Complete/, /Equipment\s*Complete/]);
  await expect(page.locator('main').locator('button, form, input, select, textarea')).toHaveCount(0);
});
