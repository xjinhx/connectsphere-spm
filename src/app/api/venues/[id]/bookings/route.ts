import { NextRequest, NextResponse } from 'next/server';
import { listVenueBookings } from '@/domain/venue-booking/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * GET /api/venues/[id]/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * SCRUM-148 AC3 and AC4: a venue's booked slots in a date range. Venue Staff,
 * the event's assigned coordinator and Event Operations Managers see each
 * booking with its event reference; any other internal user sees only that the
 * slot is committed. SCRUM-123's calendar page shows this data.
 *
 * Internal staff only (venue_catalogue_view), checked first: Event Organisers
 * and Attendees get 403, the same as the venue catalogue.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_catalogue_view');

    const { id } = await params;
    const range = {
      from: request.nextUrl.searchParams.get('from') ?? undefined,
      to: request.nextUrl.searchParams.get('to') ?? undefined,
    };
    return NextResponse.json({ bookings: await listVenueBookings(id, range, actor) });
  } catch (error) {
    return handleApiError(error);
  }
}
