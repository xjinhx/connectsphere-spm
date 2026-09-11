import { describe, it, expect } from 'vitest';
import { ApproveInputSchema, DecisionSchema } from '@/domain/review/schema';

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

  it('rejects rejected, which SCRUM-93 adds later, and typos', () => {
    expect(DecisionSchema.safeParse('rejected').success).toBe(false);
    expect(DecisionSchema.safeParse('aproved').success).toBe(false);
  });
});
