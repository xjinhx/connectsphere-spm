import { describe, it, expect } from 'vitest';
import { canRaiseChangeRequest, canRaiseChangeRequestFor } from '@/domain/change-request/policy';
import { RaiseChangeRequestInputSchema } from '@/domain/change-request/schema';

/**
 * SCRUM-187 — Request a change and track its outcome.
 *
 * The rules on their own, with no database. AC text is from the Jira card.
 * Status scope per CL-61 (PO clarification, 24 Oct 2026): offered from
 * Submitted until the event is finished — see canRaiseChangeRequest's
 * comment in policy.ts.
 */

describe('canRaiseChangeRequest (AC1 TC-187-01/02/15, AC2 TC-187-05, AC5 TC-187-08/09)', () => {
  it.each(['submitted', 'approved', 'planning', 'confirmed', 'preparation'] as const)('allows a %s event', (status) => {
    expect(canRaiseChangeRequest(status)).toBe(true);
  });

  it.each(['draft', 'clarification_requested', 'rejected', 'cancelled', 'completed'] as const)(
    'refuses a %s event',
    (status) => {
      expect(canRaiseChangeRequest(status)).toBe(false);
    },
  );
});

describe('canRaiseChangeRequestFor (AC4 TC-187-07)', () => {
  const organiserId = 'organiser-id';

  it('allows the organiser responsible for the event', () => {
    expect(canRaiseChangeRequestFor({ organiserId }, organiserId)).toBe(true);
  });

  it('refuses a colleague in the same client organisation who is not responsible', () => {
    expect(canRaiseChangeRequestFor({ organiserId }, 'colleague-id')).toBe(false);
  });
});

describe('RaiseChangeRequestInputSchema (AC1 TC-187-01/03/04)', () => {
  it('accepts one selected field with a reason', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [{ field: 'expectedAttendance', proposedValue: 180 }],
      reason: 'Extra guests confirmed',
    });
    expect(parsed.success).toBe(true);
  });

  // TC-187-03 — several fields, one reason, no duplicates.
  it('accepts several distinct fields under one reason', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [
        { field: 'expectedAttendance', proposedValue: 180 },
        { field: 'proposedDate', proposedValue: '2026-11-28' },
      ],
      reason: 'Venue and numbers both changing',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fields).toHaveLength(2);
  });

  it('refuses the same field selected twice', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [
        { field: 'expectedAttendance', proposedValue: 180 },
        { field: 'expectedAttendance', proposedValue: 190 },
      ],
      reason: 'Numbers changing',
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses no selected fields', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({ fields: [], reason: 'Something changed' });
    expect(parsed.success).toBe(false);
  });

  // TC-187-04 — a reason is required, and spaces are not a reason.
  it.each(['', '   ', '\n\t'])('refuses %j as a reason', (reason) => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [{ field: 'expectedAttendance', proposedValue: 180 }],
      reason,
    });
    expect(parsed.success).toBe(false);
  });

  // TC-187-16 (AC1) — 'name' is part of the full event-request field set per CL-61.
  it('accepts name, the full event-request field set per CL-61', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [{ field: 'name', proposedValue: 'New name' }],
      reason: 'Rebranding',
    });
    expect(parsed.success).toBe(true);
  });

  // TC-187-17 (AC1, Negative) — status is an event-status-management concern
  // (SCRUM-101/103), not a field on the event request form, so still refused.
  it('refuses a field outside the selectable set', () => {
    const parsed = RaiseChangeRequestInputSchema.safeParse({
      fields: [{ field: 'status', proposedValue: 'cancelled' }],
      reason: 'Rebranding',
    });
    expect(parsed.success).toBe(false);
  });
});
