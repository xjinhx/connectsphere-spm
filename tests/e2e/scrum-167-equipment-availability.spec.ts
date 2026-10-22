import { expect, test, type Locator, type Page } from '@playwright/test';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { signIn } from './support/accounts';
import { admin, clientOrganisationId, daysFromToday, RUN, userId } from './support/data';

/**
 * E2E-167: check equipment availability across the full commitment window
 * (SCRUM-167, Jira). The reviewer's post-merge check on PR #121 (R1 to R8),
 * repeated on every PR. Technical Support Staff go from login to the queue to
 * each event's Availability check, as a user would.
 *
 * The scenario is scripts/seed-b1.mjs's, with dates relative to today instead
 * of fixed November ones. F is the first day of S4-E1's bookings; its window
 * runs from F-1 (collection) to F+2 (Return Day). Every item has 10 units, and
 * each case has its own item, so the cases never affect each other. Other
 * events' holds are inserted by hand until SCRUM-173 reserves through the app
 * (DUMMY(SCRUM-173) D-18): a row naming a line and a quantity, which the
 * database holds for that event's whole commitment window.
 */

const F = 60; // days from today: S4-E1's first booked day
const day = (offset: number) => daysFromToday(F + offset);
const DAY = { start: '10:00', end: '18:00' };
const AM = { start: '08:00', end: '12:00' };
const PM = { start: '14:00', end: '18:00' };
const item = (n: string) => `E2E-167-${n} ${RUN}`;
const event = (key: string) => `E2E-167 ${key} ${RUN}`;

const created = { events: [] as string[], venues: [] as string[], items: [] as string[], location: '' };
const ids: Record<string, string> = {};

/** The query's data, or a clear error naming what failed to set up. */
async function must<T>(label: string, query: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<NonNullable<T>> {
  const { data, error } = await query;
  if (error || data === null || data === undefined) throw new Error(`${label}: ${error?.message ?? 'no row'}`);
  return data as NonNullable<T>;
}

/** An Approved event with its own venue: confirmed bookings on `booked`, or a booking request still Pending on `pending`. */
async function createEvent(
  key: string,
  { booked = [], pending = [], times = DAY }: { booked?: string[]; pending?: string[]; times?: typeof DAY },
): Promise<string> {
  const db = admin();
  const now = new Date().toISOString();
  const row = await must(
    `event ${key}`,
    db
      .from('event_request')
      .insert({
        name: event(key),
        purpose: 'E2E-167',
        description: 'Created by tests/e2e/scrum-167-equipment-availability.spec.ts',
        organiser_id: ids.organiser,
        client_organisation_id: await clientOrganisationId(),
        status: 'approved',
        proposed_date: booked[0] ?? pending[0],
        start_time: times.start,
        end_time: times.end,
        expected_attendance: 50,
        submitted_at: now,
        decision: 'approved',
        decided_by: ids.coordinator,
        decided_at: now,
        coordinator_id: ids.coordinator,
        assigned_by: ids.lead,
        assigned_at: now,
      })
      .select('id')
      .single(),
  );
  created.events.push(row.id);

  const venue = await must(
    `venue ${key}`,
    db
      .from('venues')
      .insert({ name: `E2E-167 Venue ${key} ${RUN}`, location_id: created.location, max_capacity: 100, opens_at: '07:00', closes_at: '23:00' })
      .select('id')
      .single(),
  );
  created.venues.push(venue.id);

  if (booked.length > 0) {
    await must(
      `bookings ${key}`,
      db
        .from('venue_booking')
        .insert(booked.map((date) => ({ venue_id: venue.id, event_request_id: row.id, date, start_time: times.start, end_time: times.end })))
        .select('id'),
    );
  }
  if (pending.length > 0) {
    const request = await must(
      `booking request ${key}`,
      db.from('venue_booking_request').insert({ event_request_id: row.id, venue_id: venue.id, requested_by: ids.coordinator }).select('id').single(),
    );
    await must(
      `booking request lines ${key}`,
      db
        .from('venue_booking_request_line')
        .insert(pending.map((date) => ({ request_id: request.id, date, start_time: times.start, end_time: times.end })))
        .select('id'),
    );
  }
  return row.id;
}

/** A line for `quantity` of the item on the event's equipment request, as its coordinator would add it. */
async function requestItem(eventId: string, itemName: string, quantity: number): Promise<string> {
  const db = admin();
  await must(
    'equipment request',
    db.from('equipment_request').upsert({ event_request_id: eventId }, { onConflict: 'event_request_id' }).select('event_request_id'),
  );
  const line = await must(
    `line ${itemName}`,
    db
      .from('equipment_request_line')
      .insert({ event_request_id: eventId, equipment_id: ids[itemName], quantity, created_by: ids.coordinator })
      .select('id')
      .single(),
  );
  return line.id;
}

/** DUMMY(SCRUM-173) D-18: reserves `quantity` of the line by hand, for its event's commitment window. */
async function reserve(lineId: string, quantity: number): Promise<void> {
  await must('reservation', admin().from('equipment_reservation').insert({ line_id: lineId, quantity }).select('id'));
}

/** Another event holding `quantity` of the item: booked on `booked`, requested and reserved. */
async function hold(key: string, booked: string[], itemName: string, quantity: number, times = DAY): Promise<void> {
  const eventId = await createEvent(key, { booked, times });
  await reserve(await requestItem(eventId, itemName, quantity), quantity);
}

test.beforeAll(async () => {
  const db = admin();
  ids.organiser = await userId('organiser@example.com');
  ids.coordinator = await userId('coordinator@example.com');
  ids.lead = await userId('ops-manager@example.com');
  ids.techSupport = await userId('tech-support@example.com');

  created.location = (await must('location', db.from('locations').insert({ name: `E2E-167 Location ${RUN}` }).select('id').single())).id;

  // The catalogue: one item per case, 10 units each (SCRUM-240).
  for (const n of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']) {
    const row = await must(
      `item ${n}`,
      db
        .from('equipment')
        .insert({ name: item(n), category: 'av', quantity: 10, current_location: 'E2E store room', created_by: ids.techSupport })
        .select('id')
        .single(),
    );
    ids[item(n)] = row.id;
    created.items.push(row.id);
  }

  // S4-E1: booked F to F+2, so its window is F-1 to F+2.
  const e1 = await createEvent('S4-E1', { booked: [day(0), day(1), day(2)] });
  await requestItem(e1, item('01'), 2);
  await requestItem(e1, item('02'), 8);
  await requestItem(e1, item('04'), 2);
  await requestItem(e1, item('05'), 6);
  await reserve(await requestItem(e1, item('06'), 6), 4); // 4 already reserved for S4-E1 itself
  await requestItem(e1, item('07'), 2);
  await requestItem(e1, item('09'), 2);
  await requestItem(e1, item('10'), 2);

  // S4-PEND: its venue booking request is still Pending, so nothing is approved.
  const pend = await createEvent('S4-PEND', { pending: [day(0), day(1), day(2)] });
  await requestItem(pend, item('03'), 2);

  // S4-AM and S4-PM: a morning and an afternoon event on the same date, F+10.
  const am = await createEvent('S4-AM', { booked: [day(10)], times: AM });
  await reserve(await requestItem(am, item('08'), 4), 4);
  const pm = await createEvent('S4-PM', { booked: [day(10)], times: PM });
  await requestItem(pm, item('08'), 2);

  // Other events' holds, at the same distances from S4-E1 as the seed's.
  await hold('H-01', [day(4), day(5)], item('01'), 4); // collects on F+3, the day after S4-E1's Return Day
  await hold('H-02', [day(-2), day(-1)], item('02'), 4); // Return Day F-1, S4-E1's collection day
  await hold('H-05', [day(0), day(1)], item('05'), 6); // inside S4-E1's window
  await hold('H-07', [day(3), day(4)], item('07'), 4); // collects on F+2, S4-E1's last day only
  await hold('H-09', [day(-3), day(-2)], item('09'), 4); // Return Day F-2, the day before S4-E1's collection
  await hold('H-10A', [day(-2), day(-1)], item('10'), 4); // S4-E1's first window day only
  await hold('H-10B', [day(3), day(4)], item('10'), 4); // S4-E1's last window day only
});

test.afterAll(async () => {
  const db = admin();
  // Events first: their bookings, requests, lines and reservations go with them (cascade).
  if (created.events.length > 0) await db.from('event_request').delete().in('id', created.events);
  if (created.items.length > 0) await db.from('equipment').delete().in('id', created.items);
  if (created.venues.length > 0) await db.from('venues').delete().in('id', created.venues);
  if (created.location) await db.from('locations').delete().eq('id', created.location);
});

/** From the Equipment request queue, opens the event's equipment page and returns its Availability check section. */
async function openFromQueue(page: Page, key: string): Promise<Locator> {
  await page.goto('/equipment-queue');
  await page.getByRole('row').filter({ hasText: event(key) }).getByRole('link', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Equipment request: ${event(key)}` })).toBeVisible();
  return page.getByRole('region', { name: 'Availability check' });
}

/** Checks an item's row: requested, already reserved, available, shortfall (AC4's columns). */
async function expectRow(check: Locator, n: string, [requested, reserved, available, shortfall]: number[]): Promise<void> {
  const cells = check.getByRole('row').filter({ hasText: item(n) }).getByRole('cell');
  await expect(cells.nth(1)).toHaveText(String(requested));
  await expect(cells.nth(2)).toHaveText(String(reserved));
  await expect(cells.nth(3)).toHaveText(String(available));
  await expect(cells.nth(4)).toHaveText(String(shortfall));
}

test('E2E-167: Technical Support check equipment availability across the full commitment window', async ({ page }) => {
  // From login: Technical Support Staff land on the Equipment request queue.
  await signIn(page, 'techSupport');
  await expect(page).toHaveURL(/\/equipment-queue$/);

  const e1 = await openFromQueue(page, 'S4-E1');

  // R1 (AC1, TC-167-01): the window runs from the collection day F-1 to the
  // Return Day F+2; units held by an event collecting on F+3 are not counted.
  await expect(e1).toContainText(`Commitment window: ${formatSingaporeDate(day(-1))} to ${formatSingaporeDate(day(2))}`);
  await expectRow(e1, '01', [2, 0, 10, 0]);

  // R2 (AC2, AC8, TC-167-02): 4 units come back on S4-E1's collection day, so
  // only 6 are available and 2 of the 8 requested are short.
  await expectRow(e1, '02', [8, 0, 6, 2]);

  // R3 (AC4, TC-167-04 to 06): requested, already reserved, available,
  // shortfall. S4-E1's own 4 reserved units are not counted against it.
  await expectRow(e1, '04', [2, 0, 10, 0]);
  await expectRow(e1, '05', [6, 0, 4, 2]);
  await expectRow(e1, '06', [6, 4, 10, 0]);

  // R4 (AC5, TC-167-07): another event sharing only the last day still takes its 4.
  await expectRow(e1, '07', [2, 0, 6, 0]);

  // R5 (AC7, TC-167-09): a Return Day the day before collection takes nothing.
  await expectRow(e1, '09', [2, 0, 10, 0]);

  // R6 (AC9, TC-167-10): 4 held on the first day only and 4 on the last day
  // only count against the busiest day: 6 available, not 2.
  await expectRow(e1, '10', [2, 0, 6, 0]);

  // R7 (AC3, TC-167-03): no approved venue booking, so the check is refused.
  const pend = await openFromQueue(page, 'S4-PEND');
  await expect(pend.getByText('This event needs an approved venue booking first.')).toBeVisible();
  await expect(pend.getByRole('table')).toHaveCount(0);

  // R8 (AC6, TC-167-08): the morning event's 4 units are not available to the
  // afternoon event on the same date.
  const pm = await openFromQueue(page, 'S4-PM');
  await expect(pm).toContainText(`Commitment window: ${formatSingaporeDate(day(9))} to ${formatSingaporeDate(day(10))}`);
  await expectRow(pm, '08', [2, 0, 6, 0]);
});
