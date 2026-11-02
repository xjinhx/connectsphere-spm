import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-110 Edit ordinary event information (Jira, authoritative):
 *   AC1 the assigned coordinator of an event that is not Cancelled or Completed
 *       edits description, internal notes, client contact name, email or phone;
 *       the changes are stored and no arrangement is flagged for review;
 *   AC2 the responsible organiser of a submitted event has no edit action and is
 *       told to request changes through their Event Coordinator;
 *   AC3 a same-organisation organiser who is not responsible can view, not edit;
 *   AC4 an organiser from a different organisation is denied;
 *   AC5 a Completed or Cancelled event is read-only for everyone, kept as history.
 *
 * Pure rules and the route. Test case IDs are from the Sprint 4 sheet's
 * SCRUM-110 tab (TC-110-nn). The database half is
 * tests/integration/edit-event-information.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-information/service', () => ({
  updateEventInformation: vi.fn(),
  getEventInformation: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { updateEventInformation } from '@/domain/event-information/service';
import { EMAIL_MESSAGE, EventInformationInputSchema } from '@/domain/event-information/schema';
import {
  REQUEST_CHANGES_THROUGH_COORDINATOR,
  canEditEventInformation,
  finishedEventNotice,
  isFinishedEvent,
} from '@/domain/event-information/policy';
import { canEditRequest, canViewRequest } from '@/domain/event-request/policy';
import { EventRequestStatusEnum, type EventRequestStatus } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import { UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { PUT } from '@/app/api/event-requests/[id]/information/route';

const COORDINATOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTHER_COORDINATOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORGANISER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const COLLEAGUE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ORG = '22222222-2222-2222-2222-222222222222';
const EV_1 = '11111111-1111-4111-8111-111111111111';

const TC_110_01_DATA = {
  description: 'Annual client gala dinner',
  internalNotes: 'VIP table near stage',
  clientContactName: 'Mei Tan',
  clientContactEmail: 'mei.tan@harbourevents.sg',
  clientContactPhone: '+65 9123 4567',
};

describe('SCRUM-110 AC1: the five fields (EventInformationSchema)', () => {
  it('SCRUM-110 AC1 TC-110-01 accepts the five fields as entered', () => {
    expect(EventInformationInputSchema.parse(TC_110_01_DATA)).toEqual(TC_110_01_DATA);
  });

  it('SCRUM-110 AC1 TC-110-02 stores a cleared optional field as null, never "null" or ""', () => {
    const parsed = EventInformationInputSchema.parse({ ...TC_110_01_DATA, internalNotes: '   ' });
    expect(parsed.internalNotes).toBeNull();
  });

  it('SCRUM-110 AC1 TC-110-04 refuses an invalid client contact email, naming that field only', () => {
    const result = EventInformationInputSchema.safeParse({ ...TC_110_01_DATA, clientContactEmail: 'mei.tan.harbourevents' });
    expect(result.success).toBe(false);
    const fieldErrors = result.success ? {} : result.error.flatten().fieldErrors;
    expect(Object.keys(fieldErrors)).toEqual(['clientContactEmail']);
    expect(fieldErrors.clientContactEmail).toEqual([EMAIL_MESSAGE]);
  });

  it('keeps the description mandatory, as at submission (SCRUM-82)', () => {
    const result = EventInformationInputSchema.safeParse({ ...TC_110_01_DATA, description: '  ' });
    expect(result.success).toBe(false);
  });

  it('takes nothing that could affect an arrangement: date, times or attendance are dropped', () => {
    const parsed = EventInformationInputSchema.parse({ ...TC_110_01_DATA, proposedDate: '2026-11-27', expectedAttendance: 180 });
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(TC_110_01_DATA).sort());
  });
});

describe('SCRUM-110 AC1 and AC5: who may edit (canEditEventInformation)', () => {
  const event = (status: EventRequestStatus, coordinatorId: string | null = COORDINATOR) => ({ status, coordinatorId });

  it.each<EventRequestStatus>(['submitted', 'approved', 'planning', 'confirmed', 'preparation'])(
    'SCRUM-110 AC1 TC-110-01/02 lets the assigned coordinator edit a %s event',
    (status) => {
      expect(canEditEventInformation(event(status), COORDINATOR)).toBe(true);
    },
  );

  it('SCRUM-110 AC1 TC-110-03 refuses a coordinator who is not assigned', () => {
    expect(canEditEventInformation(event('planning'), OTHER_COORDINATOR)).toBe(false);
  });

  it('refuses everyone on an event with no coordinator yet', () => {
    expect(canEditEventInformation(event('submitted', null), COORDINATOR)).toBe(false);
  });

  it.each<EventRequestStatus>(['completed', 'cancelled'])(
    'SCRUM-110 AC5 TC-110-10/11 refuses even the assigned coordinator on a %s event',
    (status) => {
      expect(canEditEventInformation(event(status), COORDINATOR)).toBe(false);
      expect(isFinishedEvent(status)).toBe(true);
      expect(finishedEventNotice(status)).toMatch(/read-only and kept as history/);
    },
  );

  it('treats only Completed and Cancelled as finished', () => {
    const finished = EventRequestStatusEnum.options.filter(isFinishedEvent);
    expect(finished.sort()).toEqual(['cancelled', 'completed']);
  });
});

describe('SCRUM-110 AC2-AC4: the organiser side (event-request policy)', () => {
  const submitted = { organiserId: ORGANISER, clientOrganisationId: ORG, status: 'planning' as const };

  it('SCRUM-110 AC2 TC-110-05 gives the responsible organiser no edit once submitted, and says to go through the coordinator', () => {
    expect(canEditRequest(submitted, ORGANISER)).toBe(false);
    expect(REQUEST_CHANGES_THROUGH_COORDINATOR).toMatch(/request changes through your Event Coordinator/);
  });

  it('SCRUM-110 AC2 TC-110-07 still lets the organiser edit their own draft', () => {
    expect(canEditRequest({ ...submitted, status: 'draft' }, ORGANISER)).toBe(true);
  });

  it('SCRUM-110 AC3 TC-110-08 lets a same-organisation colleague view but not edit', () => {
    expect(canViewRequest(submitted, { userId: COLLEAGUE, clientOrganisationId: ORG })).toBe(true);
    expect(canEditRequest(submitted, COLLEAGUE)).toBe(false);
  });

  it('SCRUM-110 AC4 TC-110-09 denies an organiser from another organisation', () => {
    const otherOrg = '33333333-3333-3333-3333-333333333333';
    expect(canViewRequest(submitted, { userId: COLLEAGUE, clientOrganisationId: otherOrg })).toBe(false);
  });

  it('SCRUM-110 AC2-AC4 gives the edit permission to coordinators only', () => {
    expect(isActionPermitted(['coordinator'], 'event_information_edit')).toBe(true);
    for (const role of ['event_organiser', 'operations_manager', 'venue_staff', 'technical_support', 'attendee', 'safety_officer'] as Role[]) {
      expect(isActionPermitted([role], 'event_information_edit')).toBe(false);
    }
  });
});

describe('SCRUM-110: PUT /api/event-requests/[id]/information', () => {
  function signInAs(...roles: Role[]) {
    vi.mocked(getCurrentActor).mockResolvedValue({ userId: COORDINATOR, fullName: 'Test', roles, clientOrganisation: null });
  }

  const put = (body: unknown) =>
    PUT(
      new NextRequest(`http://localhost/api/event-requests/${EV_1}/information`, { method: 'PUT', body: JSON.stringify(body) }),
      { params: Promise.resolve({ id: EV_1 }) },
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateEventInformation).mockResolvedValue(TC_110_01_DATA);
  });

  it('SCRUM-110 AC1 TC-110-01 passes a coordinator through, with the signed-in account as the editor', async () => {
    signInAs('coordinator');
    const response = await put(TC_110_01_DATA);
    expect(response.status).toBe(200);
    expect(updateEventInformation).toHaveBeenCalledWith(EV_1, COORDINATOR, TC_110_01_DATA);
  });

  it.each<Role>(['event_organiser', 'operations_manager', 'venue_staff', 'technical_support', 'attendee', 'safety_officer'])(
    'SCRUM-110 AC2/AC4 TC-110-06 refuses %s with 403, and nothing is saved',
    async (role) => {
      signInAs(role);
      const response = await put(TC_110_01_DATA);
      expect(response.status).toBe(403);
      expect(updateEventInformation).not.toHaveBeenCalled();
    },
  );

  it('refuses no session with 401, and nothing is saved', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    const response = await put(TC_110_01_DATA);
    expect(response.status).toBe(401);
    expect(updateEventInformation).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON with 400', async () => {
    signInAs('coordinator');
    const response = await PUT(
      new NextRequest(`http://localhost/api/event-requests/${EV_1}/information`, { method: 'PUT', body: '{' }),
      { params: Promise.resolve({ id: EV_1 }) },
    );
    expect(response.status).toBe(400);
    expect(updateEventInformation).not.toHaveBeenCalled();
  });
});
