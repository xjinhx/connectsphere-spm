import { describe, it, expect } from 'vitest';
import { AssignCoordinatorInputSchema, EventRequestIdSchema } from '@/domain/assignment/schema';

// SCRUM-94 — the shape of an assignment request.

const COORDINATOR_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

describe('AssignCoordinatorInputSchema', () => {
  it('accepts a coordinator and the manager making the assignment', () => {
    const result = AssignCoordinatorInputSchema.safeParse({
      coordinatorId: COORDINATOR_ID,
      actorId: ACTOR_ID,
    });
    expect(result.success).toBe(true);
  });

  it('refuses a missing coordinator: there is nobody to assign', () => {
    expect(AssignCoordinatorInputSchema.safeParse({ actorId: ACTOR_ID }).success).toBe(false);
  });

  it('refuses a coordinator id that is not a uuid', () => {
    const result = AssignCoordinatorInputSchema.safeParse({
      coordinatorId: 'jane',
      actorId: ACTOR_ID,
    });
    expect(result.success).toBe(false);
  });

  it('refuses a missing manager, so an assignment always records who made it', () => {
    expect(AssignCoordinatorInputSchema.safeParse({ coordinatorId: COORDINATOR_ID }).success).toBe(
      false,
    );
  });
});

describe('EventRequestIdSchema', () => {
  it('accepts a uuid', () => {
    expect(EventRequestIdSchema.safeParse(COORDINATOR_ID).success).toBe(true);
  });

  it('refuses a malformed id, so a bad link is a 404 rather than a database error', () => {
    expect(EventRequestIdSchema.safeParse('not-an-id').success).toBe(false);
  });
});
