import { NextRequest, NextResponse } from 'next/server';
import { getVenueCalendar } from '@/domain/venues/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/[id]/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * GET SCRUM-123: the venue's AM, PM and Night slots on every date in the
 *     range, each with its state.
 *
 * AC9 and AC10: needs venue_catalogue_view, which Event Coordinators, Venue
 * Staff, Technical Support Staff and Event Operations Managers hold and Event
 * Organisers and Attendees don't. Permission is checked before anything is
 * parsed or read (SCRUM-69 AC3), so a refused caller gets a 403 and no
 * calendar data. A bad range is a ValidationError (400); an unknown venue is
 * a NotFoundError (404).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_catalogue_view');

    const { id } = await params;
    const query = request.nextUrl.searchParams;
    const calendar = await getVenueCalendar(id, {
      from: query.get('from') ?? undefined,
      to: query.get('to') ?? undefined,
    });
    return NextResponse.json(calendar);
  } catch (error) {
    return handleApiError(error);
  }
}
