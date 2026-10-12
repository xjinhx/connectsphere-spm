import { NextRequest, NextResponse } from 'next/server';
import { releaseVenueBooking } from '@/domain/venue-booking/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/venue-bookings/[id]/release
 *
 * SCRUM-231 AC1: the event's coordinator releases one confirmed booking.
 * Body: { reason }. 200 once released; 400 without a reason, 403 for a
 * coordinator the event is not assigned to (AC3), 409 if already released.
 *
 * Needs venue_booking_request, the coordinator's permission for venue bookings
 * (SCRUM-69), checked first, the same as the route that requests a venue. The
 * narrower rule, the event's assigned coordinator only, is in the service,
 * which reads the booking's event. The releaser is whoever is signed in.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_booking_request');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    await releaseVenueBooking(id, actor.userId, body);
    return NextResponse.json({ status: 'released' });
  } catch (error) {
    return handleApiError(error);
  }
}
