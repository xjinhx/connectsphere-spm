import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-130 Filter by capacity, layout, accessibility, facilities and location:
 * the filter rules, the search with the database replaced at its boundary, and
 * the API route. tests/integration/venue-search-filters.test.ts runs the same
 * criteria against Postgres.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I set a minimum capacity of 100 and select no layout, when I
 *        search, then only venues whose maximum capacity is 100 or more are
 *        returned."
 *   AC2 "Given I set a minimum capacity of 100 and select the Theatre layout,
 *        when I search, then only venues whose recorded Theatre capacity is 100
 *        or more are returned."
 *   AC3 "Given I select a required layout, when I search, then only venues
 *        recording support for that layout are returned."
 *   AC4 "Given I select several required facilities, when I search, then only
 *        venues providing all of the selected facilities are returned."
 *   AC5 "Given venue locations are recorded against the maintained list of
 *        ConnectSphere locations and I select one of them, when I search, then
 *        only venues at that location are returned."
 *   AC6 "Given I leave location unset, when I search, then venues at all
 *        locations are returned."
 *   AC7 "Given I select one or more required accessibility features, when I
 *        search, then only venues recording all of the selected features are
 *        returned."
 *
 * The four venues are the sheet's S130-A to S130-D. Test case IDs are from the
 * SCRUM-130 tab of the Sprint 4 sheet (TC-130-nn).
 */

vi.mock('@/lib/supabase/venues', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/venues')>()),
  fetchSearchableVenues: vi.fn(),
  fetchLocationById: vi.fn(),
  fetchFacilityIdsIn: vi.fn(),
  fetchAccessibilityFeatureIdsIn: vi.fn(),
}));
// SCRUM-239's commitments are read through these, as in tests/unit/venue-search.test.ts.
vi.mock('@/lib/supabase/availability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/availability')>()),
  fetchConfirmedBookingPeriods: vi.fn(),
  fetchUnavailablePeriods: vi.fn(),
  fetchVenueSetupTurnaround: vi.fn(),
}));
vi.mock('@/lib/supabase/venueHolds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/venueHolds')>()),
  fetchActiveHoldPeriods: vi.fn(),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import {
  fetchAccessibilityFeatureIdsIn,
  fetchFacilityIdsIn,
  fetchLocationById,
  fetchSearchableVenues,
} from '@/lib/supabase/venues';
import {
  fetchConfirmedBookingPeriods,
  fetchUnavailablePeriods,
  fetchVenueSetupTurnaround,
} from '@/lib/supabase/availability';
import { fetchActiveHoldPeriods } from '@/lib/supabase/venueHolds';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { hasVenueSearchFilters, matchesVenueSearchFilters, type FilterableVenue } from '@/domain/venues/policy';
import {
  CHOOSE_LAYOUT_MESSAGE,
  MIN_CAPACITY_MESSAGE,
  VenueSearchFiltersSchema,
  type VenueSearchFilters,
} from '@/domain/venues/schema';
import { searchVenues } from '@/domain/venues/service';
import { ValidationError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { GET } from '@/app/api/venues/search/route';

const BUGIS = '10000000-0000-4000-8000-000000000001';
const JURONG = '10000000-0000-4000-8000-000000000002';
const MARINA = '10000000-0000-4000-8000-000000000003';
const PROJECTOR = '20000000-0000-4000-8000-000000000001';
const SOUND = '20000000-0000-4000-8000-000000000002';
const WHITEBOARD = '20000000-0000-4000-8000-000000000003';
const STEP_FREE = '30000000-0000-4000-8000-000000000001';
const HEARING_LOOP = '30000000-0000-4000-8000-000000000002';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

/** The sheet's four venues, as the filters see them. */
const S130: Record<'A' | 'B' | 'C' | 'D', FilterableVenue> = {
  A: {
    maxCapacity: 150,
    locationId: BUGIS,
    layouts: [
      { layout: 'theatre', capacity: 120 },
      { layout: 'banquet', capacity: 80 },
    ],
    facilityIds: [PROJECTOR, SOUND],
    accessibilityFeatureIds: [STEP_FREE, HEARING_LOOP],
  },
  B: {
    maxCapacity: 100,
    locationId: JURONG,
    layouts: [
      { layout: 'theatre', capacity: 100 },
      { layout: 'classroom', capacity: 100 },
    ],
    facilityIds: [PROJECTOR],
    accessibilityFeatureIds: [STEP_FREE],
  },
  C: {
    maxCapacity: 99,
    locationId: MARINA,
    layouts: [{ layout: 'theatre', capacity: 99 }],
    facilityIds: [SOUND],
    accessibilityFeatureIds: [],
  },
  D: {
    maxCapacity: 200,
    locationId: BUGIS,
    layouts: [{ layout: 'banquet', capacity: 200 }],
    facilityIds: [PROJECTOR, SOUND, WHITEBOARD],
    accessibilityFeatureIds: [STEP_FREE, HEARING_LOOP],
  },
};

const filters = (input: Record<string, unknown> = {}): VenueSearchFilters => VenueSearchFiltersSchema.parse(input);

/** Which of S130-A to D match `input`, in order. */
const matching = (input: Record<string, unknown>) =>
  (Object.keys(S130) as (keyof typeof S130)[]).filter((key) => matchesVenueSearchFilters(S130[key], filters(input)));

describe('SCRUM-130 AC1: minimum capacity with no layout uses the maximum capacity', () => {
  it('TC-130-01 min 100: A, B and D; not C (99)', () => {
    expect(matching({ minCapacity: '100' })).toEqual(['A', 'B', 'D']);
  });

  it('TC-130-02 min 99 includes C at exactly 99 (boundary: = max)', () => {
    expect(matching({ minCapacity: '99' })).toEqual(['A', 'B', 'C', 'D']);
  });

  it('TC-130-03 min 101 leaves out B at 100 (boundary: max + 1)', () => {
    expect(matching({ minCapacity: '101' })).toEqual(['A', 'D']);
  });

  it('TC-130-04 an empty minimum applies no capacity filter (boundary: empty)', () => {
    expect(filters({ minCapacity: '' }).minCapacity).toBeUndefined();
    expect(matching({ minCapacity: '' })).toEqual(['A', 'B', 'C', 'D']);
  });

  it.each(['0', '-5', 'abc', '10.5'])('TC-130-05 refuses %j with the capacity message', (value) => {
    const result = VenueSearchFiltersSchema.safeParse({ minCapacity: value });
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.minCapacity).toEqual([MIN_CAPACITY_MESSAGE]);
  });
});

describe('SCRUM-130 AC2: minimum capacity with a layout uses that layout capacity', () => {
  it('TC-130-06 min 100, Theatre: A (120) and B (100); not C (99) or D', () => {
    expect(matching({ minCapacity: '100', layout: 'theatre' })).toEqual(['A', 'B']);
  });

  it('TC-130-07 never falls back to the maximum: D (max 200, no Theatre) is out', () => {
    expect(matchesVenueSearchFilters(S130.D, filters({ minCapacity: '100', layout: 'theatre' }))).toBe(false);
    // A venue that records no layouts at all, like Bugis Seminar Room in seed.sql.
    expect(
      matchesVenueSearchFilters(
        { maxCapacity: 200, locationId: BUGIS, layouts: [], facilityIds: [], accessibilityFeatureIds: [] },
        filters({ minCapacity: '100', layout: 'theatre' }),
      ),
    ).toBe(false);
  });

  it('TC-130-08 Theatre 120 is in at min 120, and out at min 121 (boundary)', () => {
    expect(matching({ minCapacity: '120', layout: 'theatre' })).toEqual(['A']);
    expect(matching({ minCapacity: '121', layout: 'theatre' })).toEqual([]);
  });
});

describe('SCRUM-130 AC3: a required layout', () => {
  it('TC-130-09 Theatre only: A, B and C; not D', () => {
    expect(matching({ layout: 'theatre' })).toEqual(['A', 'B', 'C']);
  });

  it('TC-130-10 a layout none of them records returns none of them', () => {
    expect(matching({ layout: 'cabaret' })).toEqual([]);
  });

  it('refuses a layout that is not on the list', () => {
    const result = VenueSearchFiltersSchema.safeParse({ layout: 'ballroom' });
    expect(result.error?.flatten().fieldErrors.layout).toEqual([CHOOSE_LAYOUT_MESSAGE]);
  });
});

describe('SCRUM-130 AC4: all of the selected facilities', () => {
  it('TC-130-11 Projector and Sound system: A and D; not B or C', () => {
    expect(matching({ facilityIds: [PROJECTOR, SOUND] })).toEqual(['A', 'D']);
  });

  it('TC-130-12 one facility, Projector: A, B and D (boundary: one)', () => {
    expect(matching({ facilityIds: PROJECTOR })).toEqual(['A', 'B', 'D']);
  });

  it('TC-130-13 three facilities: only D, all not any (boundary)', () => {
    expect(matching({ facilityIds: [PROJECTOR, SOUND, WHITEBOARD] })).toEqual(['D']);
  });
});

describe('SCRUM-130 AC5, AC6: location', () => {
  it('TC-130-14 Bugis: A and D; not B or C', () => {
    expect(matching({ locationId: BUGIS })).toEqual(['A', 'D']);
  });

  it('TC-130-16 / TC-130-17 location unset, or cleared to empty, returns every location', () => {
    expect(matching({})).toEqual(['A', 'B', 'C', 'D']);
    expect(matching({ locationId: '' })).toEqual(['A', 'B', 'C', 'D']);
  });

  it('refuses a location that is not an id', () => {
    expect(VenueSearchFiltersSchema.safeParse({ locationId: 'Bugis' }).success).toBe(false);
  });
});

describe('SCRUM-130 AC7: all of the selected accessibility features', () => {
  it('TC-130-18 Step-free access: A, B and D; not C', () => {
    expect(matching({ accessibilityFeatureIds: STEP_FREE })).toEqual(['A', 'B', 'D']);
  });

  it('TC-130-19 Step-free access and Hearing loop: A and D; not B, all not any (boundary)', () => {
    expect(matching({ accessibilityFeatureIds: [STEP_FREE, HEARING_LOOP] })).toEqual(['A', 'D']);
  });

  it('TC-130-20 none selected applies no filter, C included (boundary: empty)', () => {
    expect(matching({ accessibilityFeatureIds: [] })).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('SCRUM-130 AC1 to AC7 together', () => {
  it('TC-130-22 min 100, Theatre, Projector, Step-free access, Bugis: only A', () => {
    expect(
      matching({
        minCapacity: '100',
        layout: 'theatre',
        facilityIds: [PROJECTOR],
        accessibilityFeatureIds: [STEP_FREE],
        locationId: BUGIS,
      }),
    ).toEqual(['A']);
  });

  it('TC-130-26 / TC-130-27 knows whether any filter is set, for the empty-result message', () => {
    expect(hasVenueSearchFilters(filters({}))).toBe(false);
    expect(hasVenueSearchFilters(filters({ minCapacity: '', layout: '', locationId: '' }))).toBe(false);
    expect(hasVenueSearchFilters(filters({ minCapacity: '100000' }))).toBe(true);
    expect(hasVenueSearchFilters(filters({ facilityIds: [PROJECTOR] }))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// searchVenues with the database replaced at its boundary
// -----------------------------------------------------------------------------

const ok = <T>(data: T) => ({ data, error: null }) as never;
const DATE = '2026-12-10';
const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VENUE_ID = { A: 'aaaaaaaa-0000-4000-8000-00000000000a', B: 'aaaaaaaa-0000-4000-8000-00000000000b' };

/** S130-A and S130-B as fetchSearchableVenues returns them, open 07:00 to 24:00. */
function rowFor(key: 'A' | 'B') {
  const venue = S130[key];
  return {
    id: VENUE_ID[key],
    name: `S130-${key}`,
    max_capacity: venue.maxCapacity,
    is_retired: false,
    opens_at: '07:00:00',
    closes_at: '24:00:00',
    setup_minutes: 0,
    turnaround_minutes: 0,
    locations: { id: venue.locationId, name: key === 'A' ? 'Bugis' : 'Jurong East' },
    venue_layouts: venue.layouts,
    venue_facilities: venue.facilityIds.map((facility_id) => ({ facility_id })),
    venue_accessibility_features: venue.accessibilityFeatureIds.map((accessibility_feature_id) => ({
      accessibility_feature_id,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchSearchableVenues).mockResolvedValue(ok([rowFor('A'), rowFor('B')]));
  vi.mocked(fetchConfirmedBookingPeriods).mockResolvedValue(ok([]));
  vi.mocked(fetchUnavailablePeriods).mockResolvedValue(ok([]));
  vi.mocked(fetchActiveHoldPeriods).mockResolvedValue(ok([]));
  vi.mocked(fetchVenueSetupTurnaround).mockResolvedValue(ok({ setup_minutes: 0, turnaround_minutes: 0 }));
  vi.mocked(fetchLocationById).mockImplementation(async (id: string) => ok(id === UNKNOWN ? null : { id }));
  vi.mocked(fetchFacilityIdsIn).mockImplementation(async (ids: string[]) =>
    ok(ids.filter((id) => id !== UNKNOWN).map((id) => ({ id }))),
  );
  vi.mocked(fetchAccessibilityFeatureIdsIn).mockImplementation(async (ids: string[]) =>
    ok(ids.filter((id) => id !== UNKNOWN).map((id) => ({ id }))),
  );
});

const search = (input: Record<string, unknown> = {}) => searchVenues({ date: DATE, start: '10:00', end: '12:00', ...input });

describe('searchVenues: the filters on top of the date and time', () => {
  it('TC-130-06 returns the venues that match, with the layout capacity to show', async () => {
    const result = await search({ minCapacity: '110', layout: 'theatre' });
    expect(result.filtered).toBe(true);
    expect(result.venues).toEqual([expect.objectContaining({ name: 'S130-A', layoutCapacity: 120 })]);
  });

  it('only checks commitments for the venues that match the filters', async () => {
    await search({ locationId: JURONG });
    const checked = vi.mocked(fetchConfirmedBookingPeriods).mock.calls.map(([venueId]) => venueId);
    expect(new Set(checked)).toEqual(new Set([VENUE_ID.B]));
  });

  it('TC-130-24 / TC-130-25 a venue matching every filter is still left out when the period is committed', async () => {
    // S130-A has a confirmed booking for the whole period (TC-130-24's set-up).
    vi.mocked(fetchConfirmedBookingPeriods).mockImplementation(async (venueId: string) =>
      ok(
        venueId === VENUE_ID.A
          ? [{ venue_id: VENUE_ID.A, event_request_id: EVENT_ID, date: DATE, start_time: '10:00:00', end_time: '12:00:00' }]
          : [],
      ),
    );
    expect((await search({ minCapacity: '100' })).venues.map((venue) => venue.name)).toEqual(['S130-B']);
  });

  it('TC-130-27 with no filter set, the result says so and nothing is narrowed', async () => {
    const result = await search();
    expect(result.filtered).toBe(false);
    expect(result.venues.map((venue) => venue.name)).toEqual(['S130-A', 'S130-B']);
    expect(result.venues.every((venue) => venue.layoutCapacity === null)).toBe(true);
  });

  it('TC-130-15 refuses a location not on the maintained list, and searches nothing', async () => {
    await expect(search({ locationId: UNKNOWN })).rejects.toThrow('Location must be chosen from the list.');
    expect(fetchSearchableVenues).not.toHaveBeenCalled();
  });

  it('TC-130-21 refuses an accessibility feature not on the list, and searches nothing', async () => {
    await expect(search({ accessibilityFeatureIds: [UNKNOWN] })).rejects.toThrow(
      'Each accessibility feature must be chosen from the list.',
    );
    expect(fetchSearchableVenues).not.toHaveBeenCalled();
  });

  it('refuses a facility not on the list', async () => {
    await expect(search({ facilityIds: [UNKNOWN] })).rejects.toThrow('Each facility must be chosen from the list.');
  });

  it('TC-130-05 names the capacity field, and still requires the date and times', async () => {
    const error = await searchVenues({ minCapacity: '0' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    const fieldErrors = (error as ValidationError).details as { fieldErrors: Record<string, string[]> };
    expect(fieldErrors.fieldErrors.minCapacity).toEqual([MIN_CAPACITY_MESSAGE]);
    expect(fieldErrors.fieldErrors.date).toBeDefined();
  });
});

// -----------------------------------------------------------------------------
// The API route
// -----------------------------------------------------------------------------

const signInAs = (...roles: Role[]) =>
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    fullName: 'Test',
    roles,
    clientOrganisation: null,
  });
const get = (query: string) => GET(new NextRequest(`http://localhost/api/venues/search?${query}`));

describe('/api/venues/search with filters', () => {
  it('TC-130-23 refuses an Event Organiser with 403, before searching', async () => {
    signInAs('event_organiser');
    const response = await get(`date=${DATE}&start=10:00&end=12:00&minCapacity=100`);
    expect(response.status).toBe(403);
    expect(fetchSearchableVenues).not.toHaveBeenCalled();
  });

  it('reads every filter from the query string, repeated facilities and features included', async () => {
    signInAs('coordinator');
    const response = await get(
      `date=${DATE}&start=10:00&end=12:00&minCapacity=100&layout=theatre&location=${BUGIS}` +
        `&facility=${PROJECTOR}&facility=${SOUND}&accessibility=${STEP_FREE}`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).venues.map((venue: { name: string }) => venue.name)).toEqual(['S130-A']);
  });

  it('TC-130-05 returns VALIDATION_ERROR for a bad minimum capacity', async () => {
    signInAs('coordinator');
    const response = await get(`date=${DATE}&start=10:00&end=12:00&minCapacity=abc`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });

  it('TC-130-15 returns VALIDATION_ERROR for a location not on the list, not an empty result', async () => {
    signInAs('coordinator');
    const response = await get(`date=${DATE}&start=10:00&end=12:00&location=${UNKNOWN}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});
