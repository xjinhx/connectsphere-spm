import { describe, expect, it } from 'vitest';
import { SESSION_IDLE_TIMEOUT_MS, isSessionIdleExpired } from '@/domain/session/policy';

describe('isSessionIdleExpired', () => {
  const lastActivityAt = new Date('2026-01-01T00:00:00.000Z');

  it('is not expired before 30 minutes of inactivity have passed', () => {
    const now = new Date(lastActivityAt.getTime() + SESSION_IDLE_TIMEOUT_MS - 1);
    expect(isSessionIdleExpired(lastActivityAt, now)).toBe(false);
  });

  it('is not expired at exactly 30 minutes', () => {
    const now = new Date(lastActivityAt.getTime() + SESSION_IDLE_TIMEOUT_MS);
    expect(isSessionIdleExpired(lastActivityAt, now)).toBe(false);
  });

  it('is expired just past 30 minutes of inactivity', () => {
    const now = new Date(lastActivityAt.getTime() + SESSION_IDLE_TIMEOUT_MS + 1);
    expect(isSessionIdleExpired(lastActivityAt, now)).toBe(true);
  });
});
