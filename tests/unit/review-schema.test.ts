import { describe, it, expect } from 'vitest';
import {
  ApproveInputSchema,
  DecisionSchema,
  RequestClarificationInputSchema,
} from '@/domain/review/schema';

describe('ApproveInputSchema', () => {
  it('accepts a valid actor id', () => {
    const result = ApproveInputSchema.safeParse({
      actorId: '123e4567-e89b-12d3-a456-426614174000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing actor id', () => {
    expect(ApproveInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an actor id that is not a UUID', () => {
    expect(ApproveInputSchema.safeParse({ actorId: 'coordinator-1' }).success).toBe(false);
  });
});

describe('DecisionSchema', () => {
  it('accepts approved', () => {
    expect(DecisionSchema.safeParse('approved').success).toBe(true);
  });

  // The database check constraint stores 'approved'; upper case would be
  // rejected by Postgres, so it must be rejected here too.
  it('rejects upper case APPROVED', () => {
    expect(DecisionSchema.safeParse('APPROVED').success).toBe(false);
  });

  it('rejects rejected, which SCRUM-93 adds later, and typos', () => {
    expect(DecisionSchema.safeParse('rejected').success).toBe(false);
    expect(DecisionSchema.safeParse('aproved').success).toBe(false);
  });
});

// SCRUM-90 AC3: "Given I attempt to request clarification without entering a
// note, when I submit, then the action is blocked and I am told a note is
// required."
describe('RequestClarificationInputSchema', () => {
  it('accepts a note describing what is needed', () => {
    const result = RequestClarificationInputSchema.safeParse({
      note: 'Please confirm the expected AV setup',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing note', () => {
    expect(RequestClarificationInputSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty note', () => {
    expect(RequestClarificationInputSchema.safeParse({ note: '' }).success).toBe(false);
  });

  // AC3 says "without entering a note" — whitespace is not an entry, so a
  // caller cannot satisfy the rule by sending spaces instead of nothing.
  it('rejects a note that is only whitespace', () => {
    expect(RequestClarificationInputSchema.safeParse({ note: '   ' }).success).toBe(false);
  });

  it('trims surrounding whitespace from a real note', () => {
    const result = RequestClarificationInputSchema.safeParse({ note: '  Needs more detail  ' });
    expect(result.success && result.data.note).toBe('Needs more detail');
  });
});
