import { NextRequest, NextResponse } from 'next/server';
import { decideVenueBookingRequest } from '@/domain/venue-booking/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/venue-booking-requests/[id]/decision
 *
 * SCRUM-148 AC1, AC2 and AC5: Venue Staff decide every pending line of a
 * booking request. Body: { decisions: [{ lineId, decision: 'approve' | 'reject',
 * reason }] }; a rejected line needs a reason.
 *
 * 200 with the request as decided. 400 for a missing reason or a line left out,
 * 409 if it was already decided or a slot is already booked (nothing saved).
 *
 * Needs venue_administration (Venue Staff's, SCRUM-69), checked before
 * anything else. The decider is whoever is signed in, never an id in the body.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    return NextResponse.json(await decideVenueBookingRequest(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
