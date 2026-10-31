import { NextRequest, NextResponse } from 'next/server';
import { listChangeRequests, raiseChangeRequest } from '@/domain/change-request/service';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-187 AC6 — list the change requests raised against an event, with
 * what was asked, their status, decision date and any reason given.
 *
 * Who may read is decided in listChangeRequests (canViewRequest): the owning
 * organiser, or a colleague in the same client organisation once the request
 * has left Draft.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(
      await listChangeRequests(id, { userId: actor.userId, clientOrganisationId: actor.clientOrganisation?.id ?? null }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * SCRUM-187 AC1 — raise a change request on a submitted or confirmed event.
 *
 * The organiser raising it is whoever is signed in (getCurrentActor), never
 * an id sent in the request body — same reasoning as the clarification
 * response route. Ownership (AC4) and the status gate (AC1/AC2/AC5) are both
 * enforced inside raiseChangeRequest before anything is written.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    const body = await req.json().catch(() => {
      throw new ValidationError('The request body must be valid JSON.');
    });
    return NextResponse.json(await raiseChangeRequest(id, body, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
