import { NextResponse } from 'next/server';
import { listEventsAwaitingSafetyCheck } from '@/domain/safety-check/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-234 AC1 — the Confirmed events awaiting an operational safety check.
 * The Safety Officer's only (AC6): the service refuses anyone else with 403,
 * and no session is 401.
 */
export async function GET() {
  try {
    const actor = await getCurrentActor();
    return NextResponse.json(await listEventsAwaitingSafetyCheck(actor));
  } catch (error) {
    return handleApiError(error);
  }
}
