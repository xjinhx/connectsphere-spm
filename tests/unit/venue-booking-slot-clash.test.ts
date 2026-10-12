import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-154 — Block a booking request that clashes with a booking or an
 * unavailable slot (Jira, authoritative). Test case IDs are the SCRUM-154
 * sheet's (TC-154-nn).
 *
 * submitVenueBookingRequest checks the requested slots before it writes, so
 * the data layer is replaced with spies and nothing here needs a database; the
 * same cases run against real rows in
 * tests/integration/submit-venue-booking-request.test.ts.
 */

vi.mock('@/lib/supabase/eventRequests', () => ({ fetchEventRequestById: vi.fn() }));
vi.mock('@/lib/supabase/venueBookingRequests', () => ({
  createVenueBookingRequest: vi.fn(),
  fetchVenueBookingRequestById: vi.fn(),
}));
vi.mock('@/lib/supabase/venueBookings', () => ({ fetchConfirmedSlotsForVenue: vi.fn() }));
vi.mock('@/lib/supabase/venues', () => ({ fetchUnavailableSlotsForVenue: vi.fn() }));
vi.mock('@/domain/venues/service', () => ({ getVenue: vi.fn() }));

import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import { createVenueBookingRequest, fetchVenueBookingRequestById } from '@/lib/supabase/venueBookingRequests';
import { fetchConfirmedSlotsForVenue } from '@/lib/supabase/venueBookings';
import { fetchUnavailableSlotsForVenue } from '@/lib/supabase/venues';
import { getVenue } from '@/domain/venues/service';
import { submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { findSlotClashes } from '@/domain/venue-booking/policy';
import { DomainError } from '@/domain/shared/errors';

const EVENT_ID = '22222222-2222-2222-2222-222222222222';
const VENUE_ID = '11111111-1111-1111-1111-111111111111';
const COORDINATOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

type Slot = 'am' | 'pm' | 'night';

/** What the venue already holds: confirmed bookings and unavailable slots, as {date, slot} rows. */
function venueHolds(held: { confirmed?: [string, Slot][]; unavailable?: [string, Slot][] }) {
  const rows = (list: [string, Slot][] = []) => list.map(([date, slot]) => ({ date, slot }));
  vi.mocked(fetchConfirmedSlotsForVenue).mockResolvedValue({ data: rows(held.confirmed), error: null } as never);
  vi.mocked(fetchUnavailableSlotsForVenue).mockResolvedValue({ data: rows(held.unavailable), error: null } as never);
}

function request(date: string, ...timeSlots: Slot[]) {
  return submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, { venueId: VENUE_ID, lines: [{ date, timeSlots }] });
}

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected the request to be refused, but it was created');
}

type ClashDetails = { clashes: { date: string; committed: Slot[]; unavailable: Slot[]; available: Slot[] }[] };

beforeEach(() => {
  vi.mocked(getVenue).mockResolvedValue({ id: VENUE_ID, isRetired: false } as never);
  vi.mocked(fetchEventRequestById).mockResolvedValue({
    data: { id: EVENT_ID, status: 'approved', coordinator_id: COORDINATOR_ID },
    error: null,
  } as never);
  vi.mocked(createVenueBookingRequest).mockReset().mockResolvedValue({ data: REQUEST_ID, error: null } as never);
  vi.mocked(fetchVenueBookingRequestById).mockReset().mockResolvedValue({
    data: {
      id: REQUEST_ID,
      event_request_id: EVENT_ID,
      venue_id: VENUE_ID,
      requested_by: COORDINATOR_ID,
      created_at: '2026-10-06T00:00:00Z',
      venue_booking_request_line: [],
    },
    error: null,
  } as never);
  venueHolds({});
});

describe('AC1: a slot with a confirmed booking is refused', () => {
  // TC-154-01
  it('refuses the PM slot and shows it as already committed', async () => {
    venueHolds({ confirmed: [['2026-11-15', 'pm']] });

    const error = await refusal(request('2026-11-15', 'pm'));

    expect(error.code).toBe('CONFLICT');
    expect(error.message).toMatch(/PM already committed/);
    expect((error.details as ClashDetails).clashes).toEqual([
      { date: '2026-11-15', committed: ['pm'], unavailable: [], available: [] },
    ]);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // TC-154-02: the reads fetch date and slot only, so nothing about the other
  // booking exists in the refusal to leak.
  it('shows nothing about the other booking in the refusal', async () => {
    // A row carrying the other booking's details, as a careless read might return it.
    vi.mocked(fetchConfirmedSlotsForVenue).mockResolvedValue({
      data: [
        {
          date: '2026-11-15',
          slot: 'pm',
          event_request: { name: 'Product Launch Gala', coordinator_id: 'someone', status: 'approved' },
        },
      ],
      error: null,
    } as never);

    const error = await refusal(request('2026-11-15', 'pm'));

    const shown = JSON.stringify({ message: error.message, details: error.details });
    expect(shown).not.toMatch(/Product Launch Gala|someone|coordinator|organisation|status|approved/i);
  });
});

describe('AC2: a slot that does not overlap is created', () => {
  // TC-154-03
  it('creates a PM request when only AM is booked', async () => {
    venueHolds({ confirmed: [['2026-11-15', 'am']] });

    await request('2026-11-15', 'pm');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  // TC-154-04
  it('creates an AM request when only PM is booked', async () => {
    venueHolds({ confirmed: [['2026-11-15', 'pm']] });

    await request('2026-11-15', 'am');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });
});

describe('AC3: a clash names the committed slot and the ones still available', () => {
  // TC-154-05
  it('refuses AM, PM and Night overall, naming PM as committed', async () => {
    venueHolds({ confirmed: [['2026-11-15', 'pm']] });

    const error = await refusal(request('2026-11-15', 'am', 'pm', 'night'));

    expect((error.details as ClashDetails).clashes).toEqual([
      { date: '2026-11-15', committed: ['pm'], unavailable: [], available: ['am', 'night'] },
    ]);
    expect(error.message).toMatch(/PM already committed; AM and Night still available/);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // TC-154-06
  it('reports per-slot detail for a two-slot request too', async () => {
    venueHolds({ confirmed: [['2026-11-15', 'pm']] });

    const error = await refusal(request('2026-11-15', 'am', 'pm'));

    expect((error.details as ClashDetails).clashes).toEqual([
      { date: '2026-11-15', committed: ['pm'], unavailable: [], available: ['am'] },
    ]);
    expect(error.message).toMatch(/PM already committed; AM still available/);
  });
});

describe('AC4: a slot recorded as unavailable is refused', () => {
  // TC-154-07
  it('refuses the AM slot', async () => {
    venueHolds({ unavailable: [['2026-11-15', 'am']] });

    const error = await refusal(request('2026-11-15', 'am'));

    expect(error.code).toBe('CONFLICT');
    expect(error.message).toMatch(/AM unavailable/);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // TC-154-08
  it('refuses an unavailable PM slot too', async () => {
    venueHolds({ unavailable: [['2026-11-15', 'pm']] });

    const error = await refusal(request('2026-11-15', 'pm'));

    expect(error.message).toMatch(/PM unavailable/);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // TC-154-09
  it('refuses the whole request when one of its slots is unavailable', async () => {
    venueHolds({ unavailable: [['2026-11-15', 'am']] });

    const error = await refusal(request('2026-11-15', 'am', 'pm'));

    expect((error.details as ClashDetails).clashes).toEqual([
      { date: '2026-11-15', committed: [], unavailable: ['am'], available: ['pm'] },
    ]);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });
});

describe('AC5: a sibling of an unavailable slot is created', () => {
  // TC-154-10
  it('creates a PM request when only AM is unavailable', async () => {
    venueHolds({ unavailable: [['2026-11-15', 'am']] });

    await request('2026-11-15', 'pm');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  // TC-154-11
  it('creates a PM and Night request when only AM is unavailable', async () => {
    venueHolds({ unavailable: [['2026-11-15', 'am']] });

    await request('2026-11-15', 'pm', 'night');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });
});

describe('Supplementary: the clash is scoped to the venue, the date and the slot', () => {
  // TC-154-12
  it('creates the same slot on a different date', async () => {
    venueHolds({ confirmed: [['2026-11-15', 'pm']] });

    await request('2026-11-16', 'pm');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  // TC-154-13: only this venue's rows are read, so another venue's bookings
  // can never appear in them.
  it('reads the requested venue and dates only', async () => {
    await request('2026-11-15', 'pm');

    expect(fetchConfirmedSlotsForVenue).toHaveBeenCalledWith(VENUE_ID, ['2026-11-15']);
    expect(fetchUnavailableSlotsForVenue).toHaveBeenCalledWith(VENUE_ID, ['2026-11-15']);
  });

  // TC-154-14
  it('creates a slot on a date other than the one it is unavailable on', async () => {
    venueHolds({ unavailable: [['2026-11-15', 'am']] });

    await request('2026-11-16', 'am');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  it('refuses a multi-date request when only one of its dates clashes, naming that date', async () => {
    venueHolds({ confirmed: [['2026-11-16', 'am']] });

    const error = await refusal(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [
          { date: '2026-11-15', timeSlots: ['pm'] },
          { date: '2026-11-16', timeSlots: ['am'] },
        ],
      }),
    );

    expect((error.details as ClashDetails).clashes.map((clash) => clash.date)).toEqual(['2026-11-16']);
    expect(fetchConfirmedSlotsForVenue).toHaveBeenCalledWith(VENUE_ID, ['2026-11-15', '2026-11-16']);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  it('reports a slot that is both booked and unavailable as committed, once', () => {
    const clashes = findSlotClashes(
      [{ date: '2026-11-15', timeSlots: ['am', 'pm'] }],
      [{ date: '2026-11-15', slot: 'am' }],
      [{ date: '2026-11-15', slot: 'am' }],
    );

    expect(clashes).toEqual([{ date: '2026-11-15', committed: ['am'], unavailable: [], available: ['pm'] }]);
  });

  it('refuses when the venue cannot be checked, rather than creating the request unchecked', async () => {
    vi.mocked(fetchConfirmedSlotsForVenue).mockResolvedValue({ data: null, error: { message: 'down' } } as never);

    const error = await refusal(request('2026-11-15', 'pm'));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });
});
