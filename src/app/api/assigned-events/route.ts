import { NextResponse } from 'next/server';
import { listMyAssignedEvents } from '@/domain/assignment/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-94 AC3 — the events assigned to the signed-in coordinator, so an
 * assignment shows up for them when they next log in.
 *
 * The coordinator is taken from the session, so this can only ever return your
 * own events. No accept or decline endpoint exists alongside it, which is the
 * rest of AC3 (clarification #95: there is no acceptance step).
 *
 * The queue page itself is SCRUM-88's story; this is the data behind it.
 */
export async function GET() {
  try {
    const actor = await getCurrentActor();
    return NextResponse.json(await listMyAssignedEvents(actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
