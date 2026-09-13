import { NextRequest, NextResponse } from 'next/server';
import { approveEventRequest } from '@/domain/review/service';
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
 * Which roles may approve is not on the Jira card, so no role check is made
 * here - raised with the team (SCRUM-69's permission matrix has no approve
 * action yet).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await approveEventRequest(id, { actorId: actor.userId }));
  } catch (error) {
    return handleApiError(error);
  }
}
