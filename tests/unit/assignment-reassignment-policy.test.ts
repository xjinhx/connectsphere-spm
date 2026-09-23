import { describe, it, expect } from 'vitest';
import {
  canBeReassigned,
  canViewCoordinatorDetails,
  isCurrentCoordinator,
} from '@/domain/assignment/policy';
import { ReassignCoordinatorInputSchema } from '@/domain/assignment/schema';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-96 Reassign an event to another coordinator
 * SCRUM-98 See who my coordinator is
 *
 * The pure rules only. AC text is from the Jira cards, which are authoritative.
 * The database half (history recorded in the same update, the race guard) is in
 * tests/integration/reassign-coordinator.test.ts.
 */

const ORGANISER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COORDINATOR_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COORDINATOR_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MANAGER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STRANGER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const as = (userId: string, roles: Role[]) => ({ userId, roles });

describe('canBeReassigned: SCRUM-96 AC1', () => {
  // US-8.1-TC03: reassign an event from Coordinator A to Coordinator B
  it('US-8.1-TC03 allows reassigning an assigned event to a different coordinator', () => {
    expect(canBeReassigned(COORDINATOR_A, COORDINATOR_B)).toBe(true);
  });

  it('refuses an event with no coordinator, which has to be assigned instead', () => {
    expect(canBeReassigned(null, COORDINATOR_B)).toBe(false);
  });

  it('refuses reassigning to the coordinator who already holds it', () => {
    expect(canBeReassigned(COORDINATOR_A, COORDINATOR_A)).toBe(false);
  });
});

describe('isCurrentCoordinator: SCRUM-96 AC4', () => {
  it('is true for the coordinator the event is assigned to', () => {
    expect(isCurrentCoordinator(COORDINATOR_B, COORDINATOR_B)).toBe(true);
  });

  it('is false for a coordinator who has been reassigned away', () => {
    expect(isCurrentCoordinator(COORDINATOR_B, COORDINATOR_A)).toBe(false);
  });

  it('is false for everyone while the event has no coordinator', () => {
    expect(isCurrentCoordinator(null, COORDINATOR_A)).toBe(false);
  });
});

describe('canViewCoordinatorDetails: SCRUM-96 AC3 and AC4, SCRUM-98', () => {
  const assignedToB = { organiserId: ORGANISER, coordinatorId: COORDINATOR_B };

  // US-8.2-TC03: the organiser opens the event and sees their coordinator
  it('US-8.2-TC03 lets the organiser who owns the event see it', () => {
    expect(canViewCoordinatorDetails(assignedToB, as(ORGANISER, ['event_organiser']))).toBe(true);
  });

  // US-8.2-TC04: an unassigned event still shows the organiser its state
  it('US-8.2-TC04 lets the organiser see an event that has no coordinator yet', () => {
    const unassigned = { organiserId: ORGANISER, coordinatorId: null };
    expect(canViewCoordinatorDetails(unassigned, as(ORGANISER, ['event_organiser']))).toBe(true);
  });

  it('lets the current coordinator see it', () => {
    expect(canViewCoordinatorDetails(assignedToB, as(COORDINATOR_B, ['coordinator']))).toBe(true);
  });

  it('lets an Event Operations Manager see it', () => {
    expect(canViewCoordinatorDetails(assignedToB, as(MANAGER, ['operations_manager']))).toBe(true);
  });

  // SCRUM-96 AC4: reassigned away means access denied
  it('SCRUM-96 AC4 refuses a coordinator who has been reassigned away', () => {
    expect(canViewCoordinatorDetails(assignedToB, as(COORDINATOR_A, ['coordinator']))).toBe(false);
  });

  it('refuses an organiser who does not own the event', () => {
    expect(canViewCoordinatorDetails(assignedToB, as(STRANGER, ['event_organiser']))).toBe(false);
  });

  it('refuses an attendee', () => {
    expect(canViewCoordinatorDetails(assignedToB, as(STRANGER, ['attendee']))).toBe(false);
  });
});

// SCRUM-215: a reassignment names the coordinator it replaces, so the update
// can refuse one made from a view that has gone out of date.
describe('ReassignCoordinatorInputSchema: SCRUM-215', () => {
  const valid = { coordinatorId: COORDINATOR_B, fromCoordinatorId: COORDINATOR_A, actorId: MANAGER };

  it('accepts the new coordinator, the one being replaced, and the manager', () => {
    expect(ReassignCoordinatorInputSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a reassignment that does not say which coordinator it replaces', () => {
    const { fromCoordinatorId: _omitted, ...withoutFrom } = valid;
    expect(ReassignCoordinatorInputSchema.safeParse(withoutFrom).success).toBe(false);
  });

  it('refuses a replaced coordinator id that is not a uuid', () => {
    expect(ReassignCoordinatorInputSchema.safeParse({ ...valid, fromCoordinatorId: 'jane' }).success).toBe(false);
  });
});
