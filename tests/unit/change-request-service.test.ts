import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-188 — Review a change request (Jira, authoritative).
 *
 * AC1: "Given a pending change request exists for my event, when I open it
 * from its notification or from the event page, then the current value and
 * the requested value are shown for each field, along with the organiser's
 * reason." AC2/AC3 (the cross-event change-request queue) moved to epic
 * SCRUM-63 per CL-50 (22 Oct 2026) and are not tested here.
 *
 * Test case IDs are the Sprint 4 sheet's SCRUM-188 tab (TC-188-nn). The data
 * layer (lib/supabase/changeRequests.ts, lib/supabase/eventRequests.ts) is
 * replaced with spies, same reasoning as tests/unit/equipment-service.test.ts:
 * getChangeRequestDetail decides access and shape before anything is read
 * again, so nothing here needs a database.
 */

vi.mock('@/lib/supabase/changeRequests', () => ({
  fetchChangeRequestById: vi.fn(),
  listChangeRequestFields: vi.fn(),
  // Unused by these tests, but mocked so the module never touches a real client.
  insertChangeRequest: vi.fn(),
  insertChangeRequestFields: vi.fn(),
  listChangeRequestsForEvent: vi.fn(),
}));
vi.mock('@/lib/supabase/eventRequests', () => ({
  fetchEventRequestById: vi.fn(),
}));

import { fetchChangeRequestById, listChangeRequestFields } from '@/lib/supabase/changeRequests';
import { fetchEventRequestById } from '@/lib/supabase/eventRequests';
import { getChangeRequestDetail } from '@/domain/change-request/service';
import { ForbiddenError } from '@/domain/shared/errors';

const CR_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const COORDINATOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COORDINATOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function changeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CR_ID,
    event_request_id: EVENT_ID,
    organiser_id: 'organiser-id',
    reason: 'Programme updated',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    created_at: '2026-10-26T01:00:00.000Z',
    ...overrides,
  };
}

/** Only coordinator_id matters to getChangeRequestDetail: the rest of the row is read by raiseChangeRequest, not this function. */
function eventRow(coordinatorId: string | null) {
  return { id: EVENT_ID, coordinator_id: coordinatorId };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getChangeRequestDetail (SCRUM-188 AC1)', () => {
  it('SCRUM-188 AC1 TC-188-01 shows the current value next to the proposed value, plus the shared reason, for every changed field', async () => {
    vi.mocked(fetchChangeRequestById).mockResolvedValue({
      data: changeRequestRow(),
      error: null,
    } as never);
    vi.mocked(fetchEventRequestById).mockResolvedValue({
      data: eventRow(COORDINATOR_A),
      error: null,
    } as never);
    vi.mocked(listChangeRequestFields).mockResolvedValue({
      data: [
        {
          id: 'f1',
          change_request_id: CR_ID,
          field: 'expectedAttendance',
          current_value: 150,
          proposed_value: 180,
        },
        {
          id: 'f2',
          change_request_id: CR_ID,
          field: 'proposedDate',
          current_value: '2026-11-10',
          proposed_value: '2026-11-15',
        },
      ],
      error: null,
    } as never);

    const detail = await getChangeRequestDetail(CR_ID, COORDINATOR_A);

    expect(detail.reason).toBe('Programme updated');
    expect(detail.status).toBe('pending');
    expect(detail.eventRequestId).toBe(EVENT_ID);
    expect(detail.fields).toEqual([
      { field: 'expectedAttendance', currentValue: 150, proposedValue: 180 },
      { field: 'proposedDate', currentValue: '2026-11-10', proposedValue: '2026-11-15' },
    ]);
  });

  it('SCRUM-188 AC1 TC-188-03 refuses a coordinator not assigned to the event, disclosing no field values', async () => {
    vi.mocked(fetchChangeRequestById).mockResolvedValue({
      data: changeRequestRow(),
      error: null,
    } as never);
    vi.mocked(fetchEventRequestById).mockResolvedValue({
      data: eventRow(COORDINATOR_A),
      error: null,
    } as never);

    await expect(getChangeRequestDetail(CR_ID, COORDINATOR_B)).rejects.toBeInstanceOf(ForbiddenError);
    expect(listChangeRequestFields).not.toHaveBeenCalled();
  });

  it('SCRUM-188 AC1 TC-188-04 shows an equipment-list field as one row with its whole current and proposed list, not one row per item', async () => {
    vi.mocked(fetchChangeRequestById).mockResolvedValue({
      data: changeRequestRow(),
      error: null,
    } as never);
    vi.mocked(fetchEventRequestById).mockResolvedValue({
      data: eventRow(COORDINATOR_A),
      error: null,
    } as never);
    vi.mocked(listChangeRequestFields).mockResolvedValue({
      data: [
        {
          id: 'f1',
          change_request_id: CR_ID,
          field: 'equipmentItems',
          current_value: [{ equipmentId: 'EQ-1', quantity: 1 }],
          proposed_value: [
            { equipmentId: 'EQ-1', quantity: 1 },
            { equipmentId: 'EQ-2', quantity: 1 },
          ],
        },
      ],
      error: null,
    } as never);

    const detail = await getChangeRequestDetail(CR_ID, COORDINATOR_A);

    expect(detail.fields).toHaveLength(1);
    expect(detail.fields[0]?.field).toBe('equipmentItems');
    expect(detail.fields[0]?.currentValue).toEqual([{ equipmentId: 'EQ-1', quantity: 1 }]);
    expect(detail.fields[0]?.proposedValue).toEqual([
      { equipmentId: 'EQ-1', quantity: 1 },
      { equipmentId: 'EQ-2', quantity: 1 },
    ]);
  });
});
