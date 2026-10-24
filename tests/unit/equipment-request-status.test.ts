import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-166 Update the status of an equipment request: the rules, and the
 * route's half of who may set a status. No database - what is saved and read
 * back is in tests/integration/equipment-request-status.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC2 "Given I am reviewing an equipment request, when I set its status to
 *        partially fulfilled, fulfilled or unable to fulfil, then the new
 *        status, my identity and the timestamp are saved and shown to the
 *        assigned coordinator."
 *   AC3 "Given some requested items are available and others are not, when I
 *        set the status to partially fulfilled, then I cannot save until every
 *        unavailable item is identified."
 *   AC4 "Given I set the status to unable to fulfil, when I save, then a
 *        reason is mandatory and the coordinator is notified."
 *
 * Test case IDs are from the SCRUM-166 tab of the Sprint 4 sheet (TC-166-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-request/service', () => ({ updateEquipmentRequestStatus: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { updateEquipmentRequestStatus } from '@/domain/equipment-request/service';
import {
  IDENTIFY_UNAVAILABLE_MESSAGE,
  REASON_REQUIRED_MESSAGE,
  UNKNOWN_LINE_MESSAGE,
  notifiesCoordinator,
  statusUpdateProblem,
  statusUpdateToStore,
  unableToFulfilMessage,
} from '@/domain/equipment-request/policy';
import { CHOOSE_STATUS_MESSAGE, UpdateEquipmentRequestStatusInputSchema } from '@/domain/equipment-request/schema';
import { notificationHref } from '@/domain/notification/policy';
import { NOTIFICATION_TYPES } from '@/domain/notification/schema';
import type { Role } from '@/domain/identity/roles';
import { UnauthenticatedError, ValidationError } from '@/domain/shared/errors';
import { PUT } from '@/app/api/event-requests/[id]/equipment-request/status/route';

const EVENT = '33333333-3333-4333-8333-333333333333';
const PROJECTOR_LINE = '44444444-4444-4444-8444-444444444444';
const MIC_LINE = '55555555-5555-4555-8555-555555555555';
const LINES = [PROJECTOR_LINE, MIC_LINE];

const parse = (input: unknown) => UpdateEquipmentRequestStatusInputSchema.safeParse(input);

describe('SCRUM-166 AC2: the four statuses, and nothing else', () => {
  it.each(['under_review', 'partially_fulfilled', 'fulfilled', 'unable_to_fulfil'])('accepts %s', (status) => {
    expect(parse({ status }).success).toBe(true);
  });

  it.each(['approved', '', 'FULFILLED', null, undefined])('TC-166-08 refuses %j with "Choose a status."', (status) => {
    const result = parse({ status });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(CHOOSE_STATUS_MESSAGE);
  });

  it('refuses an unavailable item that is not a line id', () => {
    expect(parse({ status: 'partially_fulfilled', unavailableLineIds: ['not-a-line'] }).success).toBe(false);
  });
});

describe('SCRUM-166 AC3: partially fulfilled cannot be saved until the unavailable items are identified', () => {
  it('TC-166-11 refuses partially fulfilled with no item marked (boundary: zero)', () => {
    expect(statusUpdateProblem({ status: 'partially_fulfilled', unavailableLineIds: [], reason: null }, LINES)).toEqual({
      field: 'unavailableLineIds',
      message: IDENTIFY_UNAVAILABLE_MESSAGE,
    });
  });

  it('TC-166-10 / TC-166-12 saves with exactly one of two lines marked (boundary: one)', () => {
    expect(
      statusUpdateProblem({ status: 'partially_fulfilled', unavailableLineIds: [MIC_LINE], reason: null }, LINES),
    ).toBeNull();
    expect(
      statusUpdateProblem({ status: 'partially_fulfilled', unavailableLineIds: [PROJECTOR_LINE], reason: null }, LINES),
    ).toBeNull();
  });

  it('refuses a marked line that is not on the request', () => {
    const other = '66666666-6666-4666-8666-666666666666';
    expect(
      statusUpdateProblem({ status: 'partially_fulfilled', unavailableLineIds: [other], reason: null }, LINES),
    ).toEqual({ field: 'unavailableLineIds', message: UNKNOWN_LINE_MESSAGE });
  });

  it('asks for no marked items for the other statuses, and keeps none', () => {
    for (const status of ['under_review', 'fulfilled'] as const) {
      expect(statusUpdateProblem({ status, unavailableLineIds: [], reason: null }, LINES)).toBeNull();
      expect(statusUpdateToStore({ status, unavailableLineIds: [MIC_LINE], reason: null }).unavailableLineIds).toEqual([]);
    }
  });

  it('keeps each marked line once', () => {
    expect(
      statusUpdateToStore({ status: 'partially_fulfilled', unavailableLineIds: [MIC_LINE, MIC_LINE], reason: null })
        .unavailableLineIds,
    ).toEqual([MIC_LINE]);
  });
});

describe('SCRUM-166 AC4: unable to fulfil needs a reason, and notifies the coordinator', () => {
  it('TC-166-14 refuses unable to fulfil with no reason', () => {
    const input = parse({ status: 'unable_to_fulfil' });
    expect(input.success).toBe(true);
    expect(statusUpdateProblem({ ...input.data!, reason: input.data!.reason }, LINES)).toEqual({
      field: 'reason',
      message: REASON_REQUIRED_MESSAGE,
    });
  });

  it.each(['', ' ', '   \n  '])('TC-166-15 treats %j as no reason (boundary: whitespace)', (reason) => {
    const input = parse({ status: 'unable_to_fulfil', reason });
    expect(input.data?.reason).toBeNull();
    expect(statusUpdateProblem(input.data!, LINES)?.field).toBe('reason');
  });

  it('TC-166-13 saves with a reason, trimmed, and only unable to fulfil notifies the coordinator', () => {
    const input = parse({ status: 'unable_to_fulfil', reason: '  All wireless mics are out  ' });
    expect(input.data?.reason).toBe('All wireless mics are out');
    expect(statusUpdateProblem(input.data!, LINES)).toBeNull();
    expect(notifiesCoordinator('unable_to_fulfil')).toBe(true);
    for (const status of ['under_review', 'partially_fulfilled', 'fulfilled'] as const) {
      expect(notifiesCoordinator(status)).toBe(false);
    }
  });

  it('the notification names the event and the reason', () => {
    expect(
      unableToFulfilMessage({ reference: 'EVT-2026-0001', name: 'EVT-A' }, 'All wireless mics are out'),
    ).toBe('Technical Support cannot fulfil the equipment request for EVT-2026-0001 (EVT-A): All wireless mics are out');
  });

  it('keeps the reason only for unable to fulfil', () => {
    expect(statusUpdateToStore({ status: 'fulfilled', unavailableLineIds: [], reason: 'old' }).reason).toBeNull();
    expect(statusUpdateToStore({ status: 'unable_to_fulfil', unavailableLineIds: [], reason: 'why' }).reason).toBe('why');
  });

  it('refuses a reason over 1000 characters', () => {
    expect(parse({ status: 'unable_to_fulfil', reason: 'x'.repeat(1001) }).success).toBe(false);
    expect(parse({ status: 'unable_to_fulfil', reason: 'x'.repeat(1000) }).success).toBe(true);
  });

  it('is a known notification type, opening the coordinator view of the request (regression SCRUM-241, TC-166-17)', () => {
    expect(NOTIFICATION_TYPES).toContain('equipment_unable_to_fulfil');
    expect(notificationHref({ type: 'equipment_unable_to_fulfil', eventRequestId: EVENT })).toBe(
      `/events/${EVENT}/equipment`,
    );
  });
});

describe('SCRUM-166 AC2: only Technical Support Staff can set a status (the route)', () => {
  const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const signInAs = (...roles: Role[]) =>
    vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
  const put = (body: unknown) =>
    PUT(
      new NextRequest(`http://localhost/api/event-requests/${EVENT}/equipment-request/status`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: EVENT }) },
    );

  beforeEach(() => vi.clearAllMocks());

  it.each<Role>(['coordinator', 'venue_staff', 'event_organiser'])(
    'TC-166-09 refuses %s with 403 before the service is called',
    async (role) => {
      signInAs(role);

      const response = await put({ status: 'fulfilled' });

      expect(response.status).toBe(403);
      expect(updateEquipmentRequestStatus).not.toHaveBeenCalled();
    },
  );

  it('refuses a caller who is not signed in with 401', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());

    expect((await put({ status: 'fulfilled' })).status).toBe(401);
    expect(updateEquipmentRequestStatus).not.toHaveBeenCalled();
  });

  it('passes Technical Support Staff and the body to the service, acting as the signed-in account', async () => {
    signInAs('technical_support');
    vi.mocked(updateEquipmentRequestStatus).mockResolvedValue({} as never);

    const response = await put({ status: 'fulfilled', setBy: 'someone-else' });

    expect(response.status).toBe(200);
    expect(updateEquipmentRequestStatus).toHaveBeenCalledWith(
      EVENT,
      expect.objectContaining({ userId: ACCOUNT }),
      { status: 'fulfilled', setBy: 'someone-else' },
    );
  });

  it('TC-166-11 / TC-166-14 returns the rule the service refused with as 400, naming the field', async () => {
    signInAs('technical_support');
    vi.mocked(updateEquipmentRequestStatus).mockRejectedValue(
      new ValidationError(REASON_REQUIRED_MESSAGE, { formErrors: [], fieldErrors: { reason: [REASON_REQUIRED_MESSAGE] } }),
    );

    const response = await put({ status: 'unable_to_fulfil' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: REASON_REQUIRED_MESSAGE,
      details: { fieldErrors: { reason: [REASON_REQUIRED_MESSAGE] } },
    });
  });
});
