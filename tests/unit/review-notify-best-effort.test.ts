import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * SCRUM-198 TC-198-07 — a notification failure does not block the review
 * decision itself.
 *
 * notifyBestEffort is the mechanism that guarantees this: every SCRUM-198
 * hook (approve, reject, clarify, assign) calls it AFTER the review decision
 * has already been written, and it catches and swallows any error so it
 * never propagates back to the caller.
 *
 * Mocked at the lowest honest layer - insertNotification, the actual
 * Supabase write (src/lib/supabase/notifications.ts) - rather than at
 * createNotification or notifyBestEffort themselves. Those two live in the
 * same module and call each other directly by local binding, which neither
 * vi.mock nor vi.spyOn can intercept from outside that module (confirmed:
 * two earlier attempts at mocking createNotification both let the real
 * call reach the live database instead of the mock). Mocking one layer
 * down means createNotification's own validation still runs for real, and
 * only the database write is faked - a more honest test of the real
 * chain, not a narrower one.
 *
 * No real database write is forced to fail directly: organiser_id is
 * ON DELETE RESTRICT, so there is no safe way to break that constraint
 * through the live app without risking other test data.
 */

vi.mock('@/lib/supabase/notifications', () => ({
  insertNotification: vi.fn(),
}));

import { insertNotification } from '@/lib/supabase/notifications';
import { notifyBestEffort } from '@/domain/notification/service';

describe('notifyBestEffort (TC-198-07)', () => {
  beforeEach(() => {
    vi.mocked(insertNotification).mockReset();
  });

  it('resolves normally when the write succeeds', async () => {
    vi.mocked(insertNotification).mockResolvedValueOnce({ error: null } as never);

    await expect(
      notifyBestEffort({
        recipientId: 'organiser-1',
        type: 'request_approved',
        eventRequestId: 'event-1',
        message: 'Test message',
      }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when the write fails', async () => {
    vi.mocked(insertNotification).mockResolvedValueOnce({
      error: { message: 'simulated DB write failure' },
    } as never);

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
    vi.mocked(insertNotification).mockResolvedValueOnce({
      error: { message: 'simulated DB write failure' },
    } as never);

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
