import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isWithinOpeningHours } from '@/domain/venues/policy';
import { VenueSearchQuerySchema } from '@/domain/venues/schema';
import { searchVenues } from '@/domain/venues/service';
import { fetchSearchableVenues } from '@/lib/supabase/venues';
import { fetchConfirmedBookingPeriods, fetchUnavailablePeriods } from '@/lib/supabase/availability';

/**
 * SCRUM-239 Check venue availability in 15-minute time ranges: venue search
 * (AC2, AC8's search half), and AC1's "search does not return that venue" for a period outside
 * its opening hours. Replaces SCRUM-128's slot search, which stays Done on
 * slots; its AC2 to AC5 still hold here in time ranges.
 *
 * AC1 (Jira): "... a request outside those hours is refused, and search does
 *     not return that venue for it."
 * AC2 (Jira): "Given a venue has a confirmed booking 10:00-12:00, when I search
 *     for 12:00-14:00, then the venue is returned; when I search for
 *     11:45-13:00, it is not."
 * AC8 (Jira, added 10 Oct): "Given Venue Staff has marked a venue unavailable
 *     from 14:00 to 16:30, when I search for a period overlapping it, then the
 *     venue is not returned ..." (its request half is in the request PR).
 *
 * The database layer is replaced at its boundary; searchVenues, the opening
 * hours rule and getCommittedPeriods run for real.
 * tests/integration/venue-search.test.ts runs the same criteria against Postgres.
 * Test case IDs are from ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 */

vi.mock('@/lib/supabase/venues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/venues')>()),
  fetchSearchableVenues: vi.fn(),
}));
vi.mock('@/lib/supabase/availability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/availability')>()),
  fetchConfirmedBookingPeriods: vi.fn(),
  fetchUnavailablePeriods: vi.fn(),
}));

const ok = <T>(data: T) => ({ data, error: null }) as never;
const VENUE_A = '11111111-1111-4111-8111-111111111111';
const VENUE_B = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const DATE = '2026-11-10';

const venueRow = (id: string, name: string, opensAt = '08:00:00', closesAt = '22:00:00') => ({
  id,
  name,
  max_capacity: 100,
  is_retired: false,
  opens_at: opensAt,
  closes_at: closesAt,
  locations: { id: '44444444-4444-4444-8444-444444444444', name: 'Bugis' },
});

/** Venue A has a confirmed booking 10:00-12:00 on DATE; Venue B has nothing. */
function givenVenueABookedTenToTwelve() {
  vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A'), venueRow(VENUE_B, 'Venue B')]));
  vi.mocked(fetchConfirmedBookingPeriods).mockImplementation(async (venueId: string) =>
    ok(
      venueId === VENUE_A
        ? [{ venue_id: VENUE_A, event_request_id: EVENT_ID, date: DATE, start_time: '10:00:00', end_time: '12:00:00' }]
        : [],
    ),
  );
}

async function found(start: string, end: string): Promise<string[]> {
  const result = await searchVenues({ date: DATE, start, end });
  return result.venues.map((venue) => venue.name);
}

beforeEach(() => {
  vi.mocked(fetchSearchableVenues).mockReset();
  vi.mocked(fetchConfirmedBookingPeriods).mockReset().mockResolvedValue(ok([]));
  vi.mocked(fetchUnavailablePeriods).mockReset().mockResolvedValue(ok([]));
});

describe('searchVenues: SCRUM-239 AC2, exact time ranges', () => {
  it('TC-239-05: returns the venue for 12:00-14:00, starting as its booking ends', async () => {
    givenVenueABookedTenToTwelve();
    expect(await found('12:00', '14:00')).toEqual(['Venue A', 'Venue B']);
  });

  it('TC-239-06: leaves it out for 11:45-13:00, which overlaps the booking by one step', async () => {
    givenVenueABookedTenToTwelve();
    expect(await found('11:45', '13:00')).toEqual(['Venue B']);
  });

  it('TC-239-07: returns it for 08:00-10:00, ending as the booking starts', async () => {
    givenVenueABookedTenToTwelve();
    expect(await found('08:00', '10:00')).toEqual(['Venue A', 'Venue B']);
  });

  it('asks the availability check for exactly the searched period', async () => {
    givenVenueABookedTenToTwelve();
    await found('11:45', '13:00');
    expect(fetchConfirmedBookingPeriods).toHaveBeenCalledWith(VENUE_A, DATE, DATE);
  });

  it('TC-239-20 (AC8): leaves out a venue with an unavailable period overlapping the search, and returns it once the period ends', async () => {
    vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A')]));
    vi.mocked(fetchUnavailablePeriods).mockResolvedValue(
      ok([{ venue_id: VENUE_A, date: DATE, start_time: '14:00:00', end_time: '16:30:00', reason: 'Ceiling repair' }]),
    );
    expect(await found('15:00', '16:00')).toEqual([]);
    expect(await found('16:30', '18:00')).toEqual(['Venue A']);
  });

  it('echoes the date and times searched, and no other event details', async () => {
    givenVenueABookedTenToTwelve();
    const result = await searchVenues({ date: DATE, start: '12:00', end: '14:00' });
    expect(result).toMatchObject({ date: DATE, start: '12:00', end: '14:00' });
    expect(JSON.stringify(result)).not.toContain(EVENT_ID);
  });
});

describe('searchVenues: SCRUM-239 AC1, opening hours', () => {
  it('TC-239-04: leaves out a venue for a period running past closing time', async () => {
    vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A', '08:00:00', '22:00:00')]));
    expect(await found('21:00', '23:00')).toEqual([]);
  });

  it('leaves it out for a period starting before opening time', async () => {
    vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A', '08:00:00', '22:00:00')]));
    expect(await found('07:00', '09:00')).toEqual([]);
  });

  it('TC-239-17: returns it for a period exactly matching its opening hours', async () => {
    vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A', '08:00:00', '22:00:00')]));
    expect(await found('08:00', '22:00')).toEqual(['Venue A']);
  });

  it('reads a venue open until 24:00 (a former Night slot) as open until midnight', async () => {
    vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A', '07:00:00', '24:00:00')]));
    expect(await found('22:00', '24:00')).toEqual(['Venue A']);
  });

  it('does not check the availability of a venue that is closed for the period', async () => {
    vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([venueRow(VENUE_A, 'Venue A', '08:00:00', '22:00:00')]));
    await found('21:00', '23:00');
    expect(fetchConfirmedBookingPeriods).not.toHaveBeenCalled();
  });
});

describe('isWithinOpeningHours', () => {
  const hours = { opensAt: '08:00', closesAt: '22:00' };

  it('accepts a period touching either end of the opening hours', () => {
    expect(isWithinOpeningHours({ start: '08:00', end: '09:00' }, hours)).toBe(true);
    expect(isWithinOpeningHours({ start: '21:00', end: '22:00' }, hours)).toBe(true);
  });

  it('refuses a period crossing either end by one 15-minute step', () => {
    expect(isWithinOpeningHours({ start: '07:45', end: '09:00' }, hours)).toBe(false);
    expect(isWithinOpeningHours({ start: '21:45', end: '22:15' }, hours)).toBe(false);
  });
});

describe('VenueSearchQuerySchema', () => {
  it('accepts a date with a start and end time on the 15-minute unit', () => {
    expect(VenueSearchQuerySchema.parse({ date: DATE, start: '11:30', end: '13:30' })).toEqual({
      date: DATE,
      start: '11:30',
      end: '13:30',
    });
  });

  it('SCRUM-128 AC5 still holds: a date five years ahead is accepted, no booking horizon', () => {
    expect(VenueSearchQuerySchema.safeParse({ date: '2031-10-01', start: '10:00', end: '12:00' }).success).toBe(true);
  });

  it('refuses a time off the 15-minute step', () => {
    const result = VenueSearchQuerySchema.safeParse({ date: DATE, start: '10:10', end: '12:00' });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.start).toBeDefined();
  });

  it('flags both times when the end is not after the start', () => {
    const result = VenueSearchQuerySchema.safeParse({ date: DATE, start: '14:00', end: '13:00' });
    expect(result.success).toBe(false);
    expect(Object.keys(result.error?.flatten().fieldErrors ?? {}).sort()).toEqual(['end', 'start']);
  });

  it('refuses a missing date, a malformed date and a date that does not exist', () => {
    expect(VenueSearchQuerySchema.safeParse({ start: '10:00', end: '12:00' }).success).toBe(false);
    expect(VenueSearchQuerySchema.safeParse({ date: '20/11/2026', start: '10:00', end: '12:00' }).success).toBe(false);
    expect(VenueSearchQuerySchema.safeParse({ date: '2026-02-30', start: '10:00', end: '12:00' }).success).toBe(false);
  });

  it('refuses a search without times', () => {
    expect(VenueSearchQuerySchema.safeParse({ date: DATE }).success).toBe(false);
  });

  it('refuses searchVenues input it cannot parse as a ValidationError', async () => {
    await expect(searchVenues({ date: DATE, start: '10:10', end: '12:00' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
