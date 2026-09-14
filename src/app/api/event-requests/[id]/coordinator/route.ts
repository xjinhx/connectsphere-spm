import { NextRequest, NextResponse } from 'next/server';
import { assignCoordinator } from '@/domain/assignment/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-94 AC1 — assign an Event Coordinator to a submitted event.
 *
 * AC4 — only an Event Operations Manager may assign. Checked through SCRUM-69's
 * permission matrix, which already carries `coordinator_assignment` for that
 * role, and checked before anything is read so a refusal never leaks whether
 * the event exists. Same pattern as the approve route and the account roles
 * route. Everyone else gets 403 and the event's assignment is untouched.
 *
 * The manager recorded against the assignment is whoever is signed in
 * (getCurrentActor), never an id sent in the body, so a caller cannot record
 * someone else as having made the call. The body carries only the coordinator
 * being assigned.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'coordinator_assignment');

    const body = await req.json().catch(() => ({}));
    const coordinatorId = (body as { coordinatorId?: unknown }).coordinatorId;

    return NextResponse.json(await assignCoordinator(id, { coordinatorId, actorId: actor.userId }));
  } catch (error) {
    return handleApiError(error);
  }
}
