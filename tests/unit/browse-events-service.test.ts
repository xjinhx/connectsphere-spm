import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative).
 * The service's own decisions, with the data layer replaced by spies: which
 * events Open events lists (AC1, AC2). The same reads against the database run
 * in tests/integration/browse-events.test.ts.
 *
 * Test case IDs are from SCRUM-180-test-cases.xlsx (TC-180-nn). "Today" is
 * 30/10/2026, Singapore time, unless a test says otherwise.
 */

vi.mock('@/lib/supabase/eventRegistrations', () => ({
  fetchOpenEvents: vi.fn(),
  fetchRegistrationEvent: vi.fn(),
  fetchRegisteredRegistration: vi.fn(),
  createRegistrationRow: vi.fn(),
}));

import { fetchOpenEvents } from '@/lib/supabase/eventRegistrations';
import { listOpenEvents } from '@/domain/event-registration/service';

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
    ...overrides,
  };
}

function databaseHas(...rows: ReturnType<typeof eventRow>[]) {
  vi.mocked(fetchOpenEvents).mockResolvedValue({ data: rows, error: null } as never);
}

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
