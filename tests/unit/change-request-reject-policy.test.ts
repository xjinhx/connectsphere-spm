import { describe, it, expect } from 'vitest';
import { canDecideChangeRequestFor, isPendingChangeRequest } from '@/domain/change-request/policy';
import { RejectChangeRequestInputSchema } from '@/domain/change-request/schema';

/**
 * SCRUM-191 — Reject a change request with a reason.
 *
 * The rules on their own, with no database. AC text is from the Jira card
 * (team proposal, no customer clarification ref). Test case IDs match the
 * sheet (SCRUM-191 tab); the service-level, end-to-end versions of these same
 * cases are in tests/integration/reject-change-request.test.ts.
 */

describe('isPendingChangeRequest (AC1 TC-191-01)', () => {
  it('allows a Pending change request', () => {
    expect(isPendingChangeRequest('pending')).toBe(true);
  });

  it.each(['approved', 'rejected'] as const)('refuses an already-decided (%s) change request', (status) => {
    expect(isPendingChangeRequest(status)).toBe(false);
  });
});

describe('canDecideChangeRequestFor (Supp. TC-191-05)', () => {
  const coordinatorId = 'coordinator-id';

  it('allows the event\'s currently assigned coordinator', () => {
    expect(canDecideChangeRequestFor({ coordinatorId }, coordinatorId)).toBe(true);
  });

  it('refuses a coordinator not assigned to the event', () => {
    expect(canDecideChangeRequestFor({ coordinatorId }, 'someone-else')).toBe(false);
  });

  it('refuses when the event has no coordinator assigned yet', () => {
    expect(canDecideChangeRequestFor({ coordinatorId: null }, coordinatorId)).toBe(false);
  });
});

describe('RejectChangeRequestInputSchema (AC4 TC-191-04)', () => {
  it('accepts a non-blank reason', () => {
    const parsed = RejectChangeRequestInputSchema.safeParse({ reason: 'Venue unavailable on new date' });
    expect(parsed.success).toBe(true);
  });

  it.each(['', '   ', '\n\t'])('refuses %j as a reason', (reason) => {
    const parsed = RejectChangeRequestInputSchema.safeParse({ reason });
    expect(parsed.success).toBe(false);
  });

  it('refuses a missing reason', () => {
    const parsed = RejectChangeRequestInputSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
