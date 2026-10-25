import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative).
 * The service's own decisions, with the data layer replaced by spies: which
 * events Open events lists (AC1, AC2) and how My registrations lists the
 * attendee's registrations (AC4) and marks a cancelled event (AC6). The same reads against the database run in
 * tests/integration/browse-events.test.ts.
 *
 * Test case IDs are from SCRUM-180-test-cases.xlsx (TC-180-nn). "Today" is
 * 30/10/2026, Singapore time, unless a test says otherwise.
 */

vi.mock('@/lib/supabase/eventRegistrations', () => ({
  fetchOpenEvents: vi.fn(),
  fetchMyRegistrations: vi.fn(),
  fetchRegistrationEvent: vi.fn(),
  fetchRegisteredRegistration: vi.fn(),
  createRegistrationRow: vi.fn(),
}));

import { fetchMyRegistrations, fetchOpenEvents } from '@/lib/supabase/eventRegistrations';
import { listMyRegistrations, listOpenEvents } from '@/domain/event-registration/service';

const NIGHT_ID = '11111111-1111-4111-8111-111111111111';
const BALLROOM = { name: 'Marina Bay Ballroom', address: '10 Bayfront Avenue, Singapore 018956' };

/** An event row as fetchOpenEvents returns it. */
function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NIGHT_ID,
    name: 'Client Appreciation Night',
    proposed_date: '2026-11-15',
    start_time: '18:00:00',
    end_time: '22:00:00',
    registration_start_date: '2026-10-27',
    registration_end_date: '2026-11-04',
    venue_booking: [{ status: 'confirmed', venues: BALLROOM }],
    // Read only for My registrations (AC6).
    status: 'confirmed',
    ...overrides,
  };
}

function databaseHas(...rows: ReturnType<typeof eventRow>[]) {
  vi.mocked(fetchOpenEvents).mockResolvedValue({ data: rows, error: null } as never);
}

const ATTENDEE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRIEFING_ID = '22222222-2222-4222-8222-222222222222';

/** A registration row as fetchMyRegistrations returns it, with its event. */
function registrationRow(id: string, status: string, event: ReturnType<typeof eventRow>) {
  return { id, reference: `REG-2026-000${id}`, status, event_request: event };
}

function attendeeHas(...rows: ReturnType<typeof registrationRow>[]) {
  vi.mocked(fetchMyRegistrations).mockResolvedValue({ data: rows, error: null } as never);
}

const BRIEFING = eventRow({
  id: BRIEFING_ID,
  name: 'Product Launch Briefing',
  proposed_date: '2026-11-15',
  start_time: '10:00:00',
  end_time: '12:00:00',
  venue_booking: [{ status: 'confirmed', venues: { name: 'Bugis Seminar Room', address: null } }],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AC1: an event whose registration period is open is listed', () => {
  it('TC-180-01 lists it with its name, date, start and end times and venue', async () => {
    databaseHas(eventRow());

    const events = await listOpenEvents(new Date('2026-10-30T10:00:00+08:00'));

    expect(fetchOpenEvents).toHaveBeenCalledWith('2026-10-30');
    expect(events).toEqual([
      {
        eventRequestId: NIGHT_ID,
        eventName: 'Client Appreciation Night',
        eventDate: '2026-11-15',
        times: { start: '18:00', end: '22:00' },
        venues: [BALLROOM],
      },
    ]);
  });

  it('TC-180-02 periods that start today or end today are listed, at 00:15 and 23:45 Singapore time', async () => {
    const startsToday = eventRow({ id: 'a', registration_start_date: '2026-10-30', registration_end_date: '2026-11-04' });
    const endsToday = eventRow({ id: 'b', registration_start_date: '2026-10-25', registration_end_date: '2026-10-30' });
    databaseHas(startsToday, endsToday);

    // 00:15 SGT is still 29/10 in UTC: "today" must be the Singapore date.
    for (const instant of ['2026-10-30T00:15:00+08:00', '2026-10-30T23:45:00+08:00']) {
      const events = await listOpenEvents(new Date(instant));
      expect(fetchOpenEvents).toHaveBeenLastCalledWith('2026-10-30');
      expect(events.map((event) => event.eventRequestId)).toEqual(['a', 'b']);
    }
  });
});

// The query filters by the period too; here the data layer hands back events
// outside it, to show the service's own check leaves them out.
describe('AC2: an event whose period has not opened or has closed is not listed', () => {
  it('TC-180-03 a period starting tomorrow is not listed, even at 23:45 the day before', async () => {
    databaseHas(eventRow({ registration_start_date: '2026-10-31', registration_end_date: '2026-11-09' }));

    expect(await listOpenEvents(new Date('2026-10-30T23:45:00+08:00'))).toEqual([]);
  });

  it('TC-180-04 a period that ended yesterday is not listed, even at 00:15 Singapore time', async () => {
    databaseHas(eventRow({ registration_start_date: '2026-10-20', registration_end_date: '2026-10-29' }));

    // 00:15 SGT on 30/10 is still 29/10 in UTC: a UTC date would wrongly list it.
    const events = await listOpenEvents(new Date('2026-10-30T00:15:00+08:00'));

    expect(fetchOpenEvents).toHaveBeenCalledWith('2026-10-30');
    expect(events).toEqual([]);
  });

  it('TC-180-05 an event with no registration period is not listed', async () => {
    databaseHas(eventRow({ registration_start_date: null, registration_end_date: null }));

    expect(await listOpenEvents(new Date('2026-10-30T10:00:00+08:00'))).toEqual([]);
  });
});

describe('AC4: my registrations are listed with the event and my status', () => {
  it('TC-180-09 lists each with the event name, date, times, venue and status Registered', async () => {
    attendeeHas(registrationRow('1', 'registered', eventRow()), registrationRow('2', 'registered', BRIEFING));

    const registrations = await listMyRegistrations(ATTENDEE);

    expect(fetchMyRegistrations).toHaveBeenCalledWith(ATTENDEE);
    // Same date: the earlier name first.
    expect(registrations).toEqual([
      {
        registrationId: '1',
        reference: 'REG-2026-0001',
        status: 'registered',
        eventCancelled: false,
        eventRequestId: NIGHT_ID,
        eventName: 'Client Appreciation Night',
        eventDate: '2026-11-15',
        times: { start: '18:00', end: '22:00' },
        venues: [BALLROOM],
      },
      {
        registrationId: '2',
        reference: 'REG-2026-0002',
        status: 'registered',
        eventCancelled: false,
        eventRequestId: BRIEFING_ID,
        eventName: 'Product Launch Briefing',
        eventDate: '2026-11-15',
        times: { start: '10:00', end: '12:00' },
        venues: [{ name: 'Bugis Seminar Room', address: null }],
      },
    ]);
  });

  it('TC-180-11 each shows its own status: Registered and Withdrawn', async () => {
    attendeeHas(registrationRow('1', 'registered', eventRow()), registrationRow('2', 'withdrawn', BRIEFING));

    const statuses = (await listMyRegistrations(ATTENDEE)).map((registration) => registration.status);

    expect(statuses).toEqual(['registered', 'withdrawn']);
  });

  it('TC-180-11 an attendee with no registrations gets an empty list', async () => {
    attendeeHas();

    expect(await listMyRegistrations(ATTENDEE)).toEqual([]);
  });

  it('lists the soonest event first, and an event with no date yet last', async () => {
    attendeeHas(
      registrationRow('1', 'registered', eventRow({ id: 'undated', proposed_date: null })),
      registrationRow('2', 'registered', eventRow({ id: 'later', proposed_date: '2026-12-01' })),
      registrationRow('3', 'registered', eventRow({ id: 'sooner', proposed_date: '2026-11-15' })),
    );

    const order = (await listMyRegistrations(ATTENDEE)).map((registration) => registration.eventRequestId);

    expect(order).toEqual(['sooner', 'later', 'undated']);
  });
});

describe('AC6: a cancelled event is marked Cancelled against my registration', () => {
  it('TC-180-14 the registration stays listed, with the event marked cancelled', async () => {
    attendeeHas(registrationRow('1', 'registered', eventRow({ status: 'cancelled' })));

    const [registration] = await listMyRegistrations(ATTENDEE);

    expect(registration).toMatchObject({ eventName: 'Client Appreciation Night', status: 'registered', eventCancelled: true });
  });

  it('TC-180-15 events that are Confirmed or in Preparation are not marked cancelled', async () => {
    attendeeHas(
      registrationRow('1', 'registered', eventRow({ status: 'confirmed' })),
      registrationRow('2', 'registered', { ...BRIEFING, status: 'preparation' }),
    );

    const marked = (await listMyRegistrations(ATTENDEE)).map((registration) => registration.eventCancelled);

    expect(marked).toEqual([false, false]);
  });
});
