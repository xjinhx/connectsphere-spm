import { describe, it, expect } from 'vitest';
import { NotificationTypeSchema, NotificationSchema, UnreadCountSchema } from '@/domain/notification/schema';

/**
 * SCRUM-193 View my notifications, SCRUM-198 Notify organisers about review
 * outcomes.
 *
 * The rules on their own, with no database. AC text is from the Jira card,
 * which is authoritative.
 */

describe('NotificationTypeSchema', () => {
  it.each(['clarification_requested', 'request_approved', 'request_rejected', 'coordinator_assigned'])(
    'accepts %s',
    (type) => {
      expect(NotificationTypeSchema.safeParse(type).success).toBe(true);
    },
  );

  it('rejects a type not on the known list', () => {
    expect(NotificationTypeSchema.safeParse('booking_approved').success).toBe(false);
  });

  it('rejects a non-string value', () => {
    expect(NotificationTypeSchema.safeParse(123).success).toBe(false);
  });
});

describe('NotificationSchema', () => {
  const valid = () => ({
    id: '11111111-1111-4111-8111-111111111111',
    type: 'request_approved',
    eventRequestId: '22222222-2222-4222-8222-222222222222',
    message: 'Your request was approved.',
    readAt: null,
    createdAt: '2026-09-29T00:00:00.000Z',
  });

  it('accepts a valid unread notification', () => {
    expect(NotificationSchema.safeParse(valid()).success).toBe(true);
  });

  it('accepts a read notification with a readAt timestamp', () => {
    expect(NotificationSchema.safeParse({ ...valid(), readAt: '2026-09-29T01:00:00.000Z' }).success).toBe(true);
  });

  it('rejects an id that is not a uuid', () => {
    expect(NotificationSchema.safeParse({ ...valid(), id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(NotificationSchema.safeParse({ ...valid(), type: 'something_else' }).success).toBe(false);
  });
});

describe('UnreadCountSchema', () => {
  it('accepts zero', () => {
    expect(UnreadCountSchema.safeParse({ count: 0 }).success).toBe(true);
  });

  it('accepts a positive count', () => {
    expect(UnreadCountSchema.safeParse({ count: 5 }).success).toBe(true);
  });

  it('rejects a negative count', () => {
    expect(UnreadCountSchema.safeParse({ count: -1 }).success).toBe(false);
  });

  it('rejects a fractional count', () => {
    expect(UnreadCountSchema.safeParse({ count: 1.5 }).success).toBe(false);
  });
});
