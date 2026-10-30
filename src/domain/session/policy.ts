/**
 * SCRUM-75 AC2: a session with no request for 30 minutes must be rejected on
 * the next action. Supabase's own `jwt_expiry` (see supabase/config.toml) is
 * an access-token lifetime that renews on every request via the refresh
 * token - it does not expire an idle session, so that rule is enforced here
 * instead, against a last-activity timestamp the middleware maintains.
 */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * SCRUM-264 bug fix: the cookie name is shared between the middleware (which
 * sets/reads it) and the logout route (which must clear it). Previously only
 * `src/middleware.ts` held this literal, so logout had no way to clear it -
 * the stale timestamp then got checked against the *next* login's brand-new
 * session and that first login attempt was wrongly rejected as idle.
 */
export const LAST_ACTIVITY_COOKIE = 'csp_last_activity';

export function isSessionIdleExpired(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() > SESSION_IDLE_TIMEOUT_MS;
}

/**
 * SCRUM-268: the pages a signed-out visitor may open. The middleware lets these
 * through without a session, and the shared header never shows on them, so the
 * two can't disagree about which pages are "signed out".
 */
export const SIGNED_OUT_PATHS: readonly string[] = ['/login'];

export function isSignedOutPage(pathname: string): boolean {
  return SIGNED_OUT_PATHS.includes(pathname);
}
