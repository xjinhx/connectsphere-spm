import { NextResponse } from 'next/server';
import { LAST_ACTIVITY_COOKIE } from '@/domain/session/policy';

/**
 * SCRUM-264 bug fix (found testing SCRUM-249, logged against SCRUM-75).
 *
 * DELETE clears the idle-session marker the middleware maintains
 * (csp_last_activity). The Log out button calls this alongside signing out
 * of Supabase: signOut() only clears the Supabase session cookies, which are
 * document.cookie-readable by design, but csp_last_activity is set httpOnly
 * by the middleware, so no client-side call can clear it. Left uncleared, it
 * survives logout with its old timestamp and gets checked against the next
 * login's brand-new session, so the first login attempt after a 30+ minute
 * idle gap was wrongly rejected as idle (fixed by this route; a second
 * attempt used to succeed only because the middleware's own rejection path
 * deletes the cookie as a side effect of forcing that sign-out).
 */
export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(LAST_ACTIVITY_COOKIE);
  return response;
}
