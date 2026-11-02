import { NextRequest, NextResponse } from 'next/server';
import { approveChangeRequest } from '@/domain/change-request/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * POST /api/event-requests/[id]/change-requests/[crId]/approve
 * — SCRUM-190, approve a pending change request and apply it to the event.
 *
 * No request body: approving takes nothing but the decision itself (unlike
 * SCRUM-191's reject, which needs a reason). The assigned coordinator is
 * whoever is signed in (getCurrentActor), never an id sent by the caller —
 * same reasoning as SCRUM-187's raise route. Who may decide (the event's
 * assigned coordinator) and the status gate (Pending only) are both enforced
 * inside approveChangeRequest before anything is written.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; crId: string }> }) {
  try {
    const { id, crId } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await approveChangeRequest(id, crId, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
