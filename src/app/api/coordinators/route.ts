import { NextRequest, NextResponse } from 'next/server';
import { listAssignableCoordinators } from '@/domain/assignment/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * The coordinators an event can be assigned to — the choices behind the picker
 * on the assignment queue.
 *
 * Gated by `coordinator_assignment`, the same permission the assign and reassign
 * actions use, rather than being readable by anyone signed in. This is a list of
 * staff accounts, and the only reason to read it is to assign somebody; whoever
 * cannot assign has no business enumerating who could be assigned.
 *
 * Names only, no email or contact number: SCRUM-98 owns showing a coordinator's
 * contact details, and to the organiser who needs them, not to a picker.
 */
export async function GET(_req: NextRequest) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'coordinator_assignment');
    return NextResponse.json(await listAssignableCoordinators());
  } catch (error) {
    return handleApiError(error);
  }
}
