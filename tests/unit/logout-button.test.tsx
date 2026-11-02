// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

/**
 * SCRUM-264 bug fix, review of PR #144 (Marcus): nothing tested the fix
 * itself. Deleting the fetch('/api/me/session', { method: 'DELETE' }) line
 * from LogoutButton.tsx left every other SCRUM-264 test passing, because
 * they all exercise DELETE /api/me/session and middleware() directly rather
 * than the button that is supposed to call it. This test clicks Log out and
 * checks that call is actually made.
 *
 * Test case IDs match the SCRUM-264 tab of the Sprint 4 sheet.
 */

const signOut = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signOut } }),
}));

const { LogoutButton } = await import('@/components/auth/LogoutButton');

const assign = vi.fn();

beforeEach(() => {
  signOut.mockClear();
  assign.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  // jsdom's window.location.assign is non-configurable and cannot be spied on
  // directly; replacing window.location is the usual way around that.
  Object.defineProperty(window, 'location', { value: { assign }, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SCRUM-264: LogoutButton clears the idle-session cookie', () => {
  it('TC-264-01/02: clicking Log out calls DELETE /api/me/session, alongside the working-as clear and Supabase sign-out', async () => {
    const { getByRole } = render(<LogoutButton />);

    fireEvent.click(getByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/login'));

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toContainEqual(['/api/me/session', { method: 'DELETE' }]);
    expect(calls).toContainEqual(['/api/me/working-as', { method: 'DELETE' }]);
    expect(signOut).toHaveBeenCalled();
  });
});
