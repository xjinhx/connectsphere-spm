import { NextRequest, NextResponse } from 'next/server';
import { approveEventRequest } from '@/domain/review/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-92 AC1 — approve a submitted request.
 *
 * The decision maker is whoever is signed in (getCurrentActor), never an id sent
 * in the request body, so a caller cannot record someone else as the approver.
 * No request body is read at all. Signed-out callers are refused by the
 * middleware, and getCurrentActor throws UnauthenticatedError (401) as a second
 * line of defence.
 *
 * Only coordinators may approve (the card's story is "As an Event Coordinator"),
 * checked through SCRUM-69's permission matrix before any data is read, same
 * pattern as api/accounts/[id]/roles. Other roles get 403. Narrowing this to the
 * coordinator assigned to the request (US-7.3-TC04) waits on SCRUM-94.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_request_approval');
    return NextResponse.json(await approveEventRequest(id, { actorId: actor.userId }));
  } catch (error) {
    return handleApiError(error);
  }
}
