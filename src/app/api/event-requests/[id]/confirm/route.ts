import { NextRequest, NextResponse } from 'next/server';
import { confirmEvent } from '@/domain/event-status/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/event-requests/[id]/confirm
 *
 * SCRUM-102: the event's assigned coordinator confirms it. Nothing in the body.
 *
 * 200 with { id, status: 'confirmed' }; 401 with no session; 403 for any role
 * but coordinator, or a coordinator the event is not assigned to (TC-102-17);
 * 404 for an unknown event; 409 when the event is not in Planning (TC-102-16),
 * or while an essential arrangement is outstanding, naming each one in the
 * message and in details.outstanding (AC1, AC2).
 *
 * The permission is checked first, before anything is read, the same as the
 * essential arrangements route (SCRUM-100). The confirmer is whoever is signed in.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_confirmation');

    const { id } = await params;
    return NextResponse.json(await confirmEvent(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
