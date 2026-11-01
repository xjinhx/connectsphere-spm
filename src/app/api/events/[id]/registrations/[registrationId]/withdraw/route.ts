import { NextRequest, NextResponse } from 'next/server';
import { withdrawRegistration } from '@/domain/event-registration/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/events/[id]/registrations/[registrationId]/withdraw
 *
 * SCRUM-184 AC1: the signed-in Attendee withdraws their registration, once
 * they have confirmed on the page. No body.
 *
 * 200 with the registration, now Withdrawn; 401 with no session; 403 for any
 * role but attendee; 404 for an unknown registration or someone else's
 * (TC-184-04); 409 INVALID_TRANSITION for one already withdrawn (TC-184-03).
 *
 * The permission is checked first, before anything is read. The attendee is
 * whoever is signed in, never an id from the request.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; registrationId: string }> },
) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_registration');

    const { id, registrationId } = await params;
    return NextResponse.json(await withdrawRegistration(id, registrationId, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
