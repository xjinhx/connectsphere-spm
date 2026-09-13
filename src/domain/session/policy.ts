/**
 * SCRUM-75 AC2: a session with no request for 30 minutes must be rejected on
 * the next action. Supabase's own `jwt_expiry` (see supabase/config.toml) is
 * an access-token lifetime that renews on every request via the refresh
 * token - it does not expire an idle session, so that rule is enforced here
 * instead, against a last-activity timestamp the middleware maintains.
 */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export function isSessionIdleExpired(lastActivityAt: Date, now: Date): boolean {
  return now.getTime() - lastActivityAt.getTime() > SESSION_IDLE_TIMEOUT_MS;
}
