import { NextRequest, NextResponse } from 'next/server';
import { getReviewDetail } from '@/domain/review/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-89 AC1/AC2 — open a submitted request and see everything the Event
 * Organiser provided.
 *
 * Only coordinators may review (the card's story is "As an Event
 * Coordinator"), checked through SCRUM-69's permission matrix before any data
 * is read — same pattern as the approve route. Narrowing this to the
 * coordinator assigned to the request (AC1/AC3) waits on SCRUM-94, same gap
 * already documented on the approve route.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_request_review');
    return NextResponse.json(await getReviewDetail(id));
  } catch (error) {
    return handleApiError(error);
  }
}
