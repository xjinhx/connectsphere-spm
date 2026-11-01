import { NextRequest, NextResponse } from 'next/server';
import { cancelEvent } from '@/domain/event-status/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/event-requests/[id]/cancel
 *
 * SCRUM-105: the event's assigned coordinator cancels it. Body: { reason }.
 *
 * 200 with { id, status: 'cancelled' }; 400 with no reason, or one of only
 * spaces (AC1); 401 with no session; 403 for any role but coordinator (the
 * Event Coordinator Lead included, AC2) or a coordinator the event is not
 * assigned to (AC2); 404 for an unknown event; 409 when the event is a Draft
 * or already Rejected, Completed or Cancelled (AC1).
 *
 * The permission is checked first, before anything is read, the same as the
 * complete route (SCRUM-104). The canceller is whoever is signed in.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_cancellation');

    const { id } = await params;
    const body: unknown = await request.json().catch(() => ({}));
    return NextResponse.json(await cancelEvent(id, actor, body));
  } catch (error) {
    return handleApiError(error);
  }
}
