import { NextRequest, NextResponse } from 'next/server';
import { viewVenueBookingRequest } from '@/domain/venue-booking/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * GET /api/venue-booking-requests/[id]
 *
 * SCRUM-148 AC1 and AC5: a booking request with its status (Pending, Approved,
 * Partially Approved, Rejected) and each line's decision: who decided, when,
 * and why if rejected.
 *
 * SCRUM-149 AC3: for Venue Staff and the event's assigned coordinator only
 * (viewVenueBookingRequest), the same rule as the request's page.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    const { id } = await params;
    return NextResponse.json(await viewVenueBookingRequest(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
