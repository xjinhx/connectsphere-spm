// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { RejectChangeRequestForm } from '@/components/change-request/RejectChangeRequestForm';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

/**
 * SCRUM-191 AC4: confirming a rejection without a reason is not blocked
 * silently. The button stays clickable, the request reaches the server, and
 * the server's "reason is required" message is shown to the coordinator.
 */

const REQUIRED_MESSAGE = 'A reason is required to reject a change request.';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SCRUM-191 AC4: rejecting without a reason', () => {
  it('TC-191-04 a blank reason can be confirmed and the reason-required message is shown', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: REQUIRED_MESSAGE }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getByRole, findByRole } = render(
      <RejectChangeRequestForm eventRequestId="event-1" changeRequestId="cr-1" />,
    );

    fireEvent.click(getByRole('button', { name: 'Reject' }));
    const confirm = getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);

    fireEvent.click(confirm);

    const alert = await findByRole('alert');
    expect(alert.textContent).toBe(REQUIRED_MESSAGE);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
