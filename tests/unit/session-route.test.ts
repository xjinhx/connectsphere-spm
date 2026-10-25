import { describe, expect, it } from 'vitest';
import { LAST_ACTIVITY_COOKIE } from '@/domain/session/policy';
import { DELETE } from '@/app/api/me/session/route';

/**
 * SCRUM-264 bug fix: logout did not clear `csp_last_activity`, so its stale
 * timestamp was checked against the *next* login's brand-new session and
 * the first login attempt after a 30+ minute idle gap was wrongly rejected
 * as idle (a second attempt then worked, because the middleware's own
 * idle-rejection path deletes the cookie as a side effect).
 *
 * Test case IDs match the SCRUM-264 tab of the Sprint 4 sheet.
 */
describe('SCRUM-264: DELETE /api/me/session', () => {
  it('TC-264-01: clears csp_last_activity, so the next login is not checked against a stale timestamp', async () => {
    const response = await DELETE();

    expect(response.status).toBe(204);
    const cleared = response.cookies.get(LAST_ACTIVITY_COOKIE);
    expect(cleared?.value).toBe('');
  });
});
