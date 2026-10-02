import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-142 — Submit a venue booking request for an event (Jira,
 * authoritative). Test case IDs are the SCRUM-142 sheet's (SCRUM-142-TCnn).
 *
 * submitVenueBookingRequest decides everything (assigned coordinator, event
 * status, field validation) before it writes, so the data layer is replaced
 * with spies and nothing here needs a database. What the mocks cannot prove -
 * that the row really lands in Postgres with status 'pending' - is covered by
 * the migration's own column default and CHECK constraint, and is noted in
 * each test case's Remarks.
 */

vi.mock('@/lib/supabase/eventRequests', () => ({
  fetchEventRequestById: vi.fn(),
}));
vi.mock('@/lib/supabase/venueBookingRequests', () => ({
  createVenueBookingRequest: vi.fn(),
  fetchVenueBookingRequestById: vi.fn(),
}));

import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import {
  createVenueBookingRequest,
  fetchVenueBookingRequestById,
} from '@/lib/supabase/venueBookingRequests';
import { submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { assertPermission } from '@/domain/identity/policy';
import { isActionPermitted } from '@/domain/identity/permissions';
import { DomainError } from '@/domain/shared/errors';

const EVENT_ID = '22222222-2222-2222-2222-222222222222';
const VENUE_ID = '11111111-1111-1111-1111-111111111111';
const COORDINATOR_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_COORDINATOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REQUEST_ID = '33333333-3333-3333-3333-333333333333';

function mockEvent(status: string, coordinatorId: string | null = COORDINATOR_ID) {
  vi.mocked(fetchEventRequestById).mockResolvedValue({
    data: { id: EVENT_ID, status, coordinator_id: coordinatorId },
    error: null,
  } as never);
}

/** Echo back whatever lines were written, the way the real read-back does. */
function mockWriteAndReadBack() {
  vi.mocked(createVenueBookingRequest).mockImplementation((async (input: {
    lines: readonly { date: string; timeSlots: readonly string[] }[];
  }) => {
    vi.mocked(fetchVenueBookingRequestById).mockResolvedValue({
      data: {
        id: REQUEST_ID,
        event_request_id: EVENT_ID,
        venue_id: VENUE_ID,
        requested_by: COORDINATOR_ID,
        created_at: '2026-10-03T00:00:00Z',
        venue_booking_request_line: input.lines.map((line, i) => ({
          id: `line-${i}`,
          date: line.date,
          time_slots: [...line.timeSlots],
          status: 'pending',
        })),
      },
      error: null,
    } as never);
    return { data: REQUEST_ID, error: null };
  }) as never);
}

async function caught(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected the call to be refused, but it resolved');
}

/** The names of the fields a refusal identified, however deeply nested. */
function flaggedFields(error: DomainError): string {
  return JSON.stringify(error.details ?? {});
}

beforeEach(() => {
  vi.mocked(fetchEventRequestById).mockReset();
  vi.mocked(createVenueBookingRequest).mockReset();
  vi.mocked(fetchVenueBookingRequestById).mockReset();
});

describe('AC1: assigned coordinator, approved event', () => {
  // SCRUM-142-TC01
  it('creates the request with status Pending when the event is Approved', async () => {
    mockEvent('approved');
    mockWriteAndReadBack();

    const outcome = await submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
    });

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
    expect(createVenueBookingRequest).toHaveBeenCalledWith({
      eventRequestId: EVENT_ID,
      venueId: VENUE_ID,
      requestedBy: COORDINATOR_ID,
      lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
    });
    expect(outcome.venueId).toBe(VENUE_ID);
    expect(outcome.eventRequestId).toBe(EVENT_ID);
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.lines[0]?.status).toBe('pending');
  });

  // SCRUM-142-TC06
  it('carries two slots on the same date as slot lines, each Pending', async () => {
    mockEvent('approved');
    mockWriteAndReadBack();

    const outcome = await submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
      venueId: VENUE_ID,
      lines: [{ date: '2026-11-15', timeSlots: ['am', 'pm'] }],
    });

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
    expect(outcome.lines[0]?.timeSlots).toEqual(['am', 'pm']);
    expect(outcome.lines.every((line) => line.status === 'pending')).toBe(true);
  });

  // SCRUM-142-TC02 is not here: 'planning' is not an EventRequestStatus on
  // this branch until SCRUM-101 merges, so it cannot be arranged. See sheet.
});

describe('AC2: event has not been approved', () => {
  // SCRUM-142-TC03 / TC04
  it.each(['draft', 'submitted', 'clarification_requested', 'rejected'])(
    'refuses a request on an event that is %s, and says it must be approved first',
    async (status) => {
      mockEvent(status);

      const error = await caught(
        submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
          venueId: VENUE_ID,
          lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
        }),
      );

      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.message).toMatch(/must be approved before venue arrangements/i);
      expect(createVenueBookingRequest).not.toHaveBeenCalled();
    },
  );
});

describe('AC3: several dates on one request', () => {
  // SCRUM-142-TC05
  it('writes both dates in ONE request, each line Pending', async () => {
    mockEvent('approved');
    mockWriteAndReadBack();

    const outcome = await submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
      venueId: VENUE_ID,
      lines: [
        { date: '2026-11-15', timeSlots: ['pm'] },
        { date: '2026-11-16', timeSlots: ['am'] },
      ],
    });

    expect(createVenueBookingRequest).toHaveBeenCalledOnce();
    expect(outcome.id).toBe(REQUEST_ID);
    expect(outcome.lines.map((line) => line.date)).toEqual(['2026-11-15', '2026-11-16']);
    expect(outcome.lines.map((line) => line.timeSlots)).toEqual([['pm'], ['am']]);
    expect(outcome.lines.map((line) => line.status)).toEqual(['pending', 'pending']);
    expect(new Set(outcome.lines.map((line) => line.id)).size).toBe(2);
  });
});

describe('AC4: coordinator not assigned to the event', () => {
  // SCRUM-142-TC07
  it('refuses a coordinator the event is assigned to someone else for, and creates nothing', async () => {
    mockEvent('approved', OTHER_COORDINATOR_ID);

    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
      }),
    );

    expect(error.code).toBe('FORBIDDEN');
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  it('refuses any coordinator while the event has no coordinator at all', async () => {
    mockEvent('approved', null);

    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
      }),
    );

    expect(error.code).toBe('FORBIDDEN');
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // The not-assigned refusal comes first, so it never reveals the status.
  it('refuses on assignment before it reveals the event is not approved', async () => {
    mockEvent('draft', OTHER_COORDINATOR_ID);

    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
      }),
    );

    expect(error.code).toBe('FORBIDDEN');
    expect(error.message).not.toMatch(/approved/i);
  });

  it('refuses an event that does not exist', async () => {
    vi.mocked(fetchEventRequestById).mockResolvedValue({ data: null, error: null } as never);

    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
      }),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });
});

describe('Role gate (route layer): only an Event Coordinator may request a venue', () => {
  // SCRUM-142-TC08 / TC09. The route runs assertPermission(actor.roles,
  // 'venue_booking_request') before the service is ever reached.
  it('permits the coordinator role', () => {
    expect(isActionPermitted(['coordinator'], 'venue_booking_request')).toBe(true);
    expect(() => assertPermission(['coordinator'], 'venue_booking_request')).not.toThrow();
  });

  it.each(['event_organiser', 'venue_staff', 'attendee', 'technical_support', 'operations_manager'] as const)(
    'refuses the %s role',
    (role) => {
      expect(isActionPermitted([role], 'venue_booking_request')).toBe(false);
      expect(() => assertPermission([role], 'venue_booking_request')).toThrowError(
        expect.objectContaining({ code: 'FORBIDDEN' }),
      );
    },
  );
});

describe('AC5: mandatory field left empty on an approved event', () => {
  beforeEach(() => mockEvent('approved'));

  // SCRUM-142-TC12
  it.each([
    ['empty', ''],
    ['missing', undefined],
    // SCRUM-142-TC16
    ['blank spaces', '   '],
  ])('refuses a %s date, creates nothing and flags the date', async (_label, date) => {
    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [{ date, timeSlots: ['pm'] }],
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(flaggedFields(error)).toMatch(/date/i);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // SCRUM-142-TC13
  it('refuses a request with no slot, creates nothing and flags the slot', async () => {
    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: VENUE_ID,
        lines: [{ date: '2026-11-15', timeSlots: [] }],
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(flaggedFields(error)).toMatch(/slot/i);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // SCRUM-142-TC14
  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['blank spaces', '   '],
  ])('refuses a %s venue, creates nothing and flags the venue', async (_label, venueId) => {
    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId,
        lines: [{ date: '2026-11-15', timeSlots: ['pm'] }],
      }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(flaggedFields(error)).toMatch(/venue/i);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  // SCRUM-142-TC15
  it('reports every missing field together, not just the first', async () => {
    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: '',
        lines: [{ date: '', timeSlots: [] }],
      }),
    );

    const flagged = flaggedFields(error);
    expect(flagged).toMatch(/venue/i);
    expect(flagged).toMatch(/date/i);
    expect(flagged).toMatch(/slot/i);
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });

  it('refuses a request with no date/slot lines at all', async () => {
    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, { venueId: VENUE_ID, lines: [] }),
    );

    expect(error.code).toBe('VALIDATION_ERROR');
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });
});

describe('AC2 + AC5: the approval check takes priority over the missing-field check', () => {
  // SCRUM-142-TC17. Observed: the service validates the body BEFORE reading
  // the event, so on a Draft event with every field empty the coordinator is
  // told what is missing, not that the event must be approved.
  it('on an unapproved event with every field empty, answers only "must be approved"', async () => {
    mockEvent('draft');

    const error = await caught(
      submitVenueBookingRequest(EVENT_ID, COORDINATOR_ID, {
        venueId: '',
        lines: [{ date: '', timeSlots: [] }],
      }),
    );

    expect(error.message).toMatch(/must be approved before venue arrangements/i);
    expect(error.details).toBeUndefined();
    expect(createVenueBookingRequest).not.toHaveBeenCalled();
  });
});
