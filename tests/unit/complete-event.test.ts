import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-104 Mark an event as completed.
 *
 * The rules on their own (canBeCompleted, hasEnded, isDueForCompletionCheck)
 * and the route's refusals. That the database completes and refuses the same
 * events, and records who and when, runs against it in
 * tests/integration/complete-event.test.ts.
 *
 * AC text is from the Jira card (authoritative; AC1 to AC3 updated by CL-60):
 *   AC1 "Given an event's end date has passed and its status is Preparation,
 *        when I mark it completed, then the status becomes Completed and the
 *        completion date and my name are recorded."
 *   AC2 "Given an event's end date passed 7 days ago and its status is
 *        Preparation, when the system next runs its completion check, then the
 *        event is set to Completed and recorded as system-completed."
 *   AC3 "Given a Preparation event's end date passed exactly 6 days ago, when
 *        the system runs its completion check, then the event is not
 *        auto-completed and its status is unchanged."
 *   AC4 "Given an event's end date has not yet passed, when I attempt to mark
 *        it completed, then the action is refused."
 *   AC5 "Given an event that has not passed the Operational Safety Check, when
 *        I attempt to mark it completed, then the action is refused and it
 *        cannot be marked complete."
 *
 * Test case IDs are from the SCRUM-104 tab of Marcus's Sprint 4 test cases
 * (TC-104-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-status/service', () => ({ completeEvent: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { completeEvent } from '@/domain/event-status/service';
import { POST } from '@/app/api/event-requests/[id]/complete/route';
import { canBeCompleted, hasEnded, isDueForCompletionCheck } from '@/domain/event-status/policy';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError } from '@/domain/shared/errors';

const TODAY = '2026-10-25';

describe('AC1 — the coordinator marks a Preparation event completed after its end date', () => {
  it('TC-104-01: a Preparation event whose end date was yesterday can be marked completed', () => {
    expect(canBeCompleted('preparation')).toBe(true);
    expect(hasEnded('2026-10-24', TODAY)).toBe(true);
  });
});

describe('AC4 — not before the end date has passed', () => {
  it('TC-104-03: an end date of today has not passed', () => {
    expect(hasEnded(TODAY, TODAY)).toBe(false);
  });

  it('TC-104-04: an end date in 10 days has not passed', () => {
    expect(hasEnded('2026-11-04', TODAY)).toBe(false);
  });
});

describe('AC5 — not before the event has passed the Operational Safety Check', () => {
  it('TC-104-06: a Confirmed event has not passed the safety check, so it cannot be completed', () => {
    expect(canBeCompleted('confirmed')).toBe(false);
  });

  it('TC-104-07: a Planning event has not passed the safety check', () => {
    expect(canBeCompleted('planning')).toBe(false);
  });

  it('TC-104-08: an Approved event has not passed the safety check', () => {
    expect(canBeCompleted('approved')).toBe(false);
  });
});

describe('AC2, AC3 — the completion check', () => {
  it('TC-104-10: a Preparation event whose end date was 7 days ago is due for completion', () => {
    expect(isDueForCompletionCheck('preparation', '2026-10-18', TODAY)).toBe(true);
  });

  it('TC-104-12: an end date 6 days ago is not yet due', () => {
    expect(isDueForCompletionCheck('preparation', '2026-10-19', TODAY)).toBe(false);
  });

  it('TC-104-13: no status other than Preparation is due for completion', () => {
    for (const status of EventRequestStatusEnum.options) {
      expect(isDueForCompletionCheck(status, '2026-10-18', TODAY)).toBe(status === 'preparation');
    }
  });
});

describe('Supplementary — who may mark an event completed', () => {
  const EV_1 = '11111111-1111-4111-8111-111111111111';
  const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  function signInAs(...roles: Role[]) {
    vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
  }

  const post = () =>
    POST(new NextRequest(`http://localhost/api/event-requests/${EV_1}/complete`, { method: 'POST' }), {
      params: Promise.resolve({ id: EV_1 }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(completeEvent).mockResolvedValue({ id: EV_1, status: 'completed' });
  });

  it('passes a coordinator through, as the signed-in account', async () => {
    signInAs('coordinator');
    const response = await post();
    expect(response.status).toBe(200);
    expect(completeEvent).toHaveBeenCalledWith(EV_1, expect.objectContaining({ userId: ACCOUNT }));
  });

  it('TC-104-09: the Event Coordinator Lead is refused with 403, before the event is read', async () => {
    signInAs('operations_manager');
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN');
    expect(completeEvent).not.toHaveBeenCalled();
  });

  it('TC-104-09: a coordinator the event is not assigned to is refused with 403', async () => {
    signInAs('coordinator');
    vi.mocked(completeEvent).mockRejectedValue(new ForbiddenError('This event is not assigned to you.'));
    const response = await post();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe('FORBIDDEN');
  });
});
