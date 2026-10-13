import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-239 Check venue availability in 15-minute time ranges, Part 3/4: the
 * booking request (Jira, authoritative).
 *
 * AC1 (request part): "... a request outside those hours is refused ..."
 * AC3: "Given that same booking [confirmed 10:00-12:00], when I submit a
 *      request for 11:00-13:00, then it is refused and the clashing period is
 *      named, without any other event's details."
 * AC7 (request part): bookings created under the slot model "are still
 *      evaluated for conflicts".
 * AC8 (request half): "... when I submit a request for that period [overlapping
 *      an unavailable 14:00-16:30], then it is refused and the clashing period
 *      is named, without any other event's details."
 *
 * Replaces SCRUM-154's slot checks (SCRUM-154 stays Done on slots, Week 7
 * guide); its rules carry over in time ranges and are kept below as
 * regressions (TC-154-nn). SCRUM-227 AC5: an event's own hold does not block
 * its own request.
 *
 * getVenueCommitments, the one availability check, is replaced at its
 * boundary with a venue holding the commitments each test sets up;
 * everything above it runs for real. Test case IDs are from
 * ConnectSphere_TestCases_Sprint3_238_239_226.xlsx.
 */

vi.mock('@/lib/supabase/eventRequests', () => ({ fetchEventRequestById: vi.fn() }));
vi.mock('@/lib/supabase/venueBookingRequests', () => ({
  createVenueBookingRequest: vi.fn(),
  fetchVenueBookingRequestById: vi.fn(),
}));
vi.mock('@/lib/supabase/venues', () => ({ fetchVenueOpeningHours: vi.fn() }));
vi.mock('@/domain/availability/service', () => ({ getVenueCommitments: vi.fn() }));
vi.mock('@/domain/venues/service', () => ({ getVenue: vi.fn() }));

import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import { createVenueBookingRequest, fetchVenueBookingRequestById } from '@/lib/supabase/venueBookingRequests';
import { fetchVenueOpeningHours } from '@/lib/supabase/venues';
import { getVenueCommitments } from '@/domain/availability/service';
import { getVenue } from '@/domain/venues/service';
import { submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { describePeriodClashes, overlappingLines } from '@/domain/venue-booking/policy';
import type { VenueCommitment } from '@/domain/availability/schema';
import { rangesOverlap, splitDateTime } from '@/domain/shared/times';
import { DomainError } from '@/domain/shared/errors';

const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_EVENT_ID = '44444444-4444-4444-8444-444444444444';
const VENUE_ID = '11111111-1111-4111-8111-111111111111';
const COORDINATOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const DATE = '2026-11-10';

const commitment = (
  kind: VenueCommitment['kind'],
  start: string,
  end: string,
  extra: Partial<VenueCommitment> = {},
): VenueCommitment => ({
  kind,
  venueId: VENUE_ID,
  date: DATE,
  start,
  end,
  eventRequestId: kind === 'unavailable' ? null : OTHER_EVENT_ID,
  reason: kind === 'unavailable' ? 'Ceiling repair' : null,
  ...extra,
});

/** The venue's commitments; getVenueCommitments returns those overlapping the asked range, as the real one does. */
function venueHas(...commitments: VenueCommitment[]) {
  vi.mocked(getVenueCommitments).mockImplementation(async (_venueId, start, end) => {
    const from = splitDateTime(start);
    const to = splitDateTime(end);
    return commitments.filter((c) => c.date === from.date && rangesOverlap(c, { start: from.time, end: to.time }));
  });
}

function venueOpen(opensAt: string, closesAt: string) {
  vi.mocked(fetchVenueOpeningHours).mockResolvedValue({
    data: { opens_at: `${opensAt}:00`, closes_at: `${closesAt}:00` },
    error: null,
  } as never);
}

function request(start: string, end: string, date = DATE) {
  return submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, { venueId: VENUE_ID, lines: [{ date, start, end }] });
}

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected the request to be refused, but it was created');
}

type ClashDetails = {
  reason: string;
  clashes: { lineIndex: number; date: string; start: string; end: string; committed: { date: string; start: string; end: string }[] }[];
  lineErrors: Record<string, string[]>[];
};

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
      created_at: '2026-10-12T00:00:00Z',
      venue_booking_request_line: [],
    },
    error: null,
  } as never);
  vi.mocked(getVenueCommitments).mockReset();
  venueHas();
  venueOpen('07:00', '24:00');
});

describe('SCRUM-239 AC3: a request overlapping a confirmed booking is refused, naming the period', () => {
  it('TC-239-08: refuses 11:00-13:00 against a booking 10:00-12:00 and names 10:00-12:00', async () => {
    venueHas(commitment('booking', '10:00', '12:00'));

    const error = await refusal(request('11:00', '13:00'));

    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe(
      'This venue cannot be requested for that time. 10 Nov 2026 11:00–13:00 clashes with 10:00–12:00, which is already committed.',
    );
    expect((error.details as ClashDetails).clashes).toEqual([
      { lineIndex: 0, date: DATE, start: '11:00', end: '13:00', committed: [{ date: DATE, start: '10:00', end: '12:00' }] },
    ]);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  it('TC-239-09: shows no event id, name, organiser or reason anywhere in the refusal', async () => {
    venueHas(commitment('booking', '10:00', '12:00'));

    const error = await refusal(request('11:00', '13:00'));

    const shown = JSON.stringify({ message: error.message, details: error.details });
    expect(shown).not.toContain(OTHER_EVENT_ID);
    expect(shown).not.toMatch(/eventRequestId|"kind"|organiser|client/i);
  });

  it('TC-239-18: refuses the smallest overlap, one 15-minute step (11:45-13:00)', async () => {
    venueHas(commitment('booking', '10:00', '12:00'));

    const error = await refusal(request('11:45', '13:00'));

    expect(error.message).toMatch(/clashes with 10:00–12:00/);
  });

  it('shows the clash beside the line it belongs to', async () => {
    venueHas(commitment('booking', '10:00', '12:00'));

    const error = await refusal(request('11:00', '13:00'));

    expect((error.details as ClashDetails).lineErrors).toEqual([{ start: ['Clashes with 10:00–12:00, already committed.'] }]);
  });

  it('creates a request starting as the booking ends (12:00-14:00), as AC2 searches', async () => {
    venueHas(commitment('booking', '10:00', '12:00'));

    await request('12:00', '14:00');

    expect(createVenueBookingRequest).toHaveBeenCalledWith(
      expect.objectContaining({ lines: [{ date: DATE, start: '12:00', end: '14:00' }] }),
    );
  });

  it('creates a request ending as the booking starts (08:00-10:00)', async () => {
    venueHas(commitment('booking', '10:00', '12:00'));

    await request('08:00', '10:00');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  it('asks the availability check for exactly the requested period', async () => {
    await request('11:00', '13:00');

    expect(getVenueCommitments).toHaveBeenCalledWith(VENUE_ID, `${DATE}T11:00`, `${DATE}T13:00`);
  });
});

describe('SCRUM-239 AC7: a booking made under the slot model still clashes', () => {
  it('TC-239-16: refuses 11:00-12:30 against an AM booking, naming 07:00-12:00', async () => {
    // The time-model migration gave the AM booking 07:00-12:00; getVenueCommitments returns it so.
    venueHas(commitment('booking', '07:00', '12:00'));

    const error = await refusal(request('11:00', '12:30'));

    expect(error.message).toMatch(/clashes with 07:00–12:00/);
  });
});

describe('SCRUM-239 AC8 (request half): a request overlapping an unavailable period is refused', () => {
  it('TC-239-25: refuses 15:00-16:00 against unavailable 14:00-16:30, naming the period and not the reason', async () => {
    venueHas(commitment('unavailable', '14:00', '16:30'));

    const error = await refusal(request('15:00', '16:00'));

    expect(error.message).toBe(
      'This venue cannot be requested for that time. 10 Nov 2026 15:00–16:00 clashes with 14:00–16:30, which is already committed.',
    );
    expect(JSON.stringify(error.details)).not.toMatch(/Ceiling repair/);
  });

  it('TC-239-26: creates 16:30-18:00, starting as the unavailable period ends', async () => {
    venueHas(commitment('unavailable', '14:00', '16:30'));

    await request('16:30', '18:00');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });
});

describe('SCRUM-239 AC1 (request part): a request outside the opening hours is refused', () => {
  it("TC-239-03: refuses 07:00-09:00 at a venue open 08:00-22:00, saying it is outside the venue's hours", async () => {
    venueOpen('08:00', '22:00');

    const error = await refusal(request('07:00', '09:00'));

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe("This venue cannot be requested for that time. Outside this venue's opening hours (08:00–22:00).");
    expect((error.details as ClashDetails).lineErrors[0]).toEqual({
      start: ["Outside this venue's opening hours (08:00–22:00)."],
      end: ["Outside this venue's opening hours (08:00–22:00)."],
    });
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  it('TC-239-17: creates a request exactly matching the opening hours, and refuses one past closing', async () => {
    venueOpen('08:00', '22:00');

    await request('08:00', '22:00');
    expect(createVenueBookingRequest).toHaveBeenCalledOnce();

    const error = await refusal(request('21:45', '22:15'));
    expect(error.message).toMatch(/outside this venue's opening hours/i);
  });

  it('checks the opening hours before the clash, without asking for commitments', async () => {
    venueOpen('08:00', '22:00');

    await refusal(request('07:00', '09:00'));

    expect(getVenueCommitments).not.toHaveBeenCalled();
  });
});

describe("SCRUM-227 AC5: the event's own hold does not block its own request", () => {
  it('creates a request over a period held for this event', async () => {
    venueHas(commitment('hold', '10:00', '12:00', { eventRequestId: EVENT_ID, expiresAt: '2026-11-08T09:00:00.000Z' }));

    await request('10:00', '12:00');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  it("refuses a period held for another event, naming the period only (SCRUM-227 AC3)", async () => {
    venueHas(commitment('hold', '10:00', '12:00', { expiresAt: '2026-11-08T09:00:00.000Z' }));

    const error = await refusal(request('11:00', '12:00'));

    expect(error.message).toMatch(/clashes with 10:00–12:00/);
    expect(JSON.stringify(error.details)).not.toContain(OTHER_EVENT_ID);
  });
});

describe('Regression: SCRUM-154 in time ranges', () => {
  it('TC-154-03: creates a PM request (13:00-18:00) when only AM (07:00-12:00) is booked', async () => {
    venueHas(commitment('booking', '07:00', '12:00'));

    await request('13:00', '18:00');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  it('TC-154-12: creates the same period on a different date', async () => {
    venueHas(commitment('booking', '13:00', '18:00'));

    await request('13:00', '18:00', '2026-11-11');

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
  });

  it('TC-154-13: asks about the requested venue only', async () => {
    await request('13:00', '18:00');

    expect(vi.mocked(getVenueCommitments).mock.calls.every(([venueId]) => venueId === VENUE_ID)).toBe(true);
  });

  it('refuses a multi-date request when only one of its dates clashes, naming that date', async () => {
    venueHas(commitment('booking', '09:00', '11:00', { date: '2026-11-11' }));

    const error = await refusal(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [
          { date: DATE, start: '09:00', end: '11:00' },
          { date: '2026-11-11', start: '10:00', end: '12:00' },
        ],
      }),
    );

    expect((error.details as ClashDetails).clashes.map((clash) => [clash.lineIndex, clash.date])).toEqual([[1, '2026-11-11']]);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  it('refuses when the venue cannot be checked, rather than creating the request unchecked', async () => {
    vi.mocked(getVenueCommitments).mockRejectedValue(new Error('down'));

    await expect(request('13:00', '18:00')).rejects.toThrow();
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });
});

describe('two lines of one request that overlap', () => {
  it('refuses them before checking the venue, flagging the second line', async () => {
    const error = await refusal(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [
          { date: DATE, start: '09:00', end: '11:00' },
          { date: DATE, start: '10:30', end: '12:00' },
        ],
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect((error.details as ClashDetails).lineErrors).toEqual([
      {},
      { start: ['Overlaps another period on the same date in this request.'] },
    ]);
    expect(getVenueCommitments).not.toHaveBeenCalled();
  });

  it('allows back-to-back periods, and the same period on different dates', () => {
    expect(
      overlappingLines([
        { date: DATE, start: '09:00', end: '11:00' },
        { date: DATE, start: '11:00', end: '12:00' },
        { date: '2026-11-11', start: '09:00', end: '11:00' },
      ]),
    ).toEqual([]);
  });
});

describe('describePeriodClashes', () => {
  it('lists several committed periods for one line', () => {
    expect(
      describePeriodClashes([
        {
          lineIndex: 0,
          date: DATE,
          start: '09:00',
          end: '17:00',
          committed: [
            { date: DATE, start: '10:00', end: '12:00' },
            { date: DATE, start: '14:00', end: '16:30' },
          ],
        },
      ]),
    ).toBe(
      'This venue cannot be requested for that time. 10 Nov 2026 09:00–17:00 clashes with 10:00–12:00 and 14:00–16:30, which are already committed.',
    );
  });
});
