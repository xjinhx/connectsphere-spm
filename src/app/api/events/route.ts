import { NextResponse } from 'next/server';

/**
 * Stub protected endpoint. Reaching this handler at all means the middleware
 * already confirmed a session exists - it exists to make AC3's "protected API
 * endpoints return 401 without a valid session" testable end to end.
 */
export async function GET() {
  return NextResponse.json({ events: [] });
}
