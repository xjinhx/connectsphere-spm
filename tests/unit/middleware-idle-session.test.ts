import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { LAST_ACTIVITY_COOKIE } from '@/domain/session/policy';

/**
 * SCRUM-264 bug fix: logout did not clear `csp_last_activity`. Its stale
 * timestamp was then checked against the *next* login's brand-new session,
 * so the first login attempt after a 30+ minute idle gap was wrongly
 * rejected as idle (a second attempt worked only because the middleware's
 * own idle-rejection path happens to delete the cookie as a side effect).
 *
 * These tests exercise `middleware()` directly against a fake Supabase
 * client, matching the two cookie states logout can leave behind now that
 * DELETE /api/me/session (session-route.test.ts) clears the marker:
 * - a stale leftover cookie (the bug, reproduced here to show the exact
 *   mechanism the fix removes the cause of);
 * - no cookie at all (the fixed logout path) - the fresh session's first
 *   request must succeed.
 * A genuinely idle *existing* session (no logout in between) must still be
 * rejected, so the fix does not disable idle expiry altogether.
 *
 * Test case IDs match the SCRUM-264 tab of the Sprint 4 sheet.
 */

const signOut = vi.fn().mockResolvedValue({ error: null });
const getUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser, signOut },
  }),
}));

const { middleware } = await import('@/middleware');

const FAKE_USER = { id: 'user-1', email: 'user@example.com' };

function requestWithCookie(path: string, cookie?: { value: string }) {
  const request = new NextRequest(`http://localhost${path}`);
  if (cookie) {
    request.cookies.set(LAST_ACTIVITY_COOKIE, cookie.value);
  }
  return request;
}

describe('SCRUM-264: middleware idle check after a fresh login', () => {
  // TC-264-01 (review, PR #144): step 2 of the sheet's repro - if the cookie
  // were still stale (logout had not cleared it), the *next* login's
  // brand-new session gets wrongly rejected as idle. Step 1 (logout actually
  // clears the cookie) is session-route.test.ts.
  it('TC-264-01 (regression, old behaviour): a stale leftover cookie from before logout wrongly rejects a brand-new session', async () => {
    getUser.mockResolvedValue({ data: { user: FAKE_USER } });
    const staleTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    const response = await middleware(requestWithCookie('/assigned-events', { value: staleTimestamp }));

    // This is the bug: a genuinely fresh session (just logged in) gets
    // rejected (redirected to /login) because an old, uncleared cookie makes
    // it look idle.
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(signOut).toHaveBeenCalled();
  });

  // TC-264-02 (review, PR #144): logging out and logging back in immediately
  // is unaffected - with no leftover cookie, the first request on the fresh
  // session succeeds, and a new csp_last_activity is set for it (so idle
  // expiry still applies going forward; the fix only removes the stale
  // leftover, not the mechanism).
  it('TC-264-02: with the cookie cleared on logout (the fix), the first request on a fresh session succeeds and sets a fresh cookie', async () => {
    getUser.mockResolvedValue({ data: { user: FAKE_USER } });

    const response = await middleware(requestWithCookie('/assigned-events'));

    expect(response.status).toBe(200);
    const fresh = response.cookies.get(LAST_ACTIVITY_COOKIE);
    expect(fresh?.value).toBeTruthy();
    expect(new Date(fresh!.value).getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it('TC-264-03: a genuinely idle existing session is still rejected (idle expiry is not disabled by the fix)', async () => {
    getUser.mockResolvedValue({ data: { user: FAKE_USER } });
    const staleTimestamp = new Date(Date.now() - 31 * 60 * 1000).toISOString();

    const response = await middleware(requestWithCookie('/assigned-events', { value: staleTimestamp }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(signOut).toHaveBeenCalled();
  });

  // Not a sheet TC: a boundary check that activity inside the idle window
  // still succeeds, so TC-264-03's rejection is really about being idle, not
  // about having any cookie at all.
  it('activity inside the idle window is not rejected', async () => {
    getUser.mockResolvedValue({ data: { user: FAKE_USER } });
    const recentTimestamp = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const response = await middleware(requestWithCookie('/assigned-events', { value: recentTimestamp }));

    expect(response.status).toBe(200);
  });
});
