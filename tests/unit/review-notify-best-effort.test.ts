import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SCRUM-198 TC-198-07 — a notification failure does not block the review
 * decision itself.
 *
 * notifyBestEffort is the mechanism that guarantees this: every SCRUM-198
 * hook (approve, reject, clarify, assign) calls it AFTER the review decision
 * has already been written, and it catches and swallows any error from
 * createNotification rather than letting it propagate back to the caller.
 * This tests that guarantee directly and in isolation, by mocking
 * createNotification to throw - no real database write is forced to fail,
 * which would risk corrupting other test data or require breaking a foreign
 * key constraint that the schema deliberately enforces (organiser_id is
 * ON DELETE RESTRICT, so there is no safe way to force this failure through
 * the live app or database).
 */

vi.mock('@/domain/notification/service', () => ({
  createNotification: vi.fn(),
}));

import { createNotification } from '@/domain/notification/service';
import { notifyBestEffort } from '@/domain/review/service';

describe('notifyBestEffort (TC-198-07)', () => {
  beforeEach(() => {
    vi.mocked(createNotification).mockReset();
  });

  it('resolves normally when createNotification succeeds', async () => {
    vi.mocked(createNotification).mockResolvedValueOnce(undefined);

    await expect(
      notifyBestEffort({
        recipientId: 'organiser-1',
        type: 'request_approved',
        eventRequestId: 'event-1',
        message: 'Test message',
      }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when createNotification rejects', async () => {
    vi.mocked(createNotification).mockRejectedValueOnce(new Error('simulated DB write failure'));

    await expect(
      notifyBestEffort({
        recipientId: 'organiser-1',
        type: 'request_rejected',
        eventRequestId: 'event-1',
        message: 'Test message',
      }),
    ).resolves.toBeUndefined();
  });

  it('logs the error rather than silently discarding it', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createNotification).mockRejectedValueOnce(new Error('simulated DB write failure'));

    await notifyBestEffort({
      recipientId: 'organiser-1',
      type: 'clarification_requested',
      eventRequestId: 'event-1',
      message: 'Test message',
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Could not create notification',
      'clarification_requested',
      'event-1',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
