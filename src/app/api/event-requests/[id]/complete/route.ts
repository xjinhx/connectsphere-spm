import { NextRequest, NextResponse } from 'next/server';
import { completeEvent } from '@/domain/event-status/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/event-requests/[id]/complete
 *
 * SCRUM-104: the event's assigned coordinator marks it completed. Nothing in
 * the body.
 *
 * 200 with { id, status: 'completed' }; 401 with no session; 403 for any role
 * but coordinator, or a coordinator the event is not assigned to (TC-104-09);
 * 404 for an unknown event; 409 when the event is not in Preparation (AC5) or
 * its end date has not passed (AC4).
 *
 * The permission is checked first, before anything is read, the same as the
 * confirm route (SCRUM-102). The completer is whoever is signed in.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_completion');

    const { id } = await params;
    return NextResponse.json(await completeEvent(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
