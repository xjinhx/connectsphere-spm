import { NextRequest, NextResponse } from 'next/server';
import { getVenueBookingDecision } from '@/domain/venue-booking/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * GET /api/venue-booking-requests/[id]
 *
 * SCRUM-148 AC1 and AC5: a booking request with its status (Pending, Approved,
 * Partially Approved, Rejected) and each line's decision: who decided, when,
 * and why if rejected. For Venue Staff (venue_administration), checked first.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

    const { id } = await params;
    return NextResponse.json(await getVenueBookingDecision(id));
  } catch (error) {
    return handleApiError(error);
  }
}
