import { NextRequest, NextResponse } from 'next/server';
import { searchVenues } from '@/domain/venues/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/search?date=YYYY-MM-DD&start=HH:MM&end=HH:MM
 *
 * GET SCRUM-239 AC2: the venues open and free for the whole period on the date
 *     (replacing SCRUM-128's slots).
 *     Needs venue_catalogue_view, the same as browsing the catalogue it
 *     searches, so Event Organisers and Attendees are refused.
 *
 * Permission is checked before anything is parsed or read (SCRUM-69 AC3). A
 * missing or invalid date, or a time off the 15-minute unit or an end not after
 * the start (ClockRangeSchema), is a ValidationError: 400.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_catalogue_view');

    const params = request.nextUrl.searchParams;
    const result = await searchVenues({
      date: params.get('date') ?? undefined,
      start: params.get('start') ?? undefined,
      end: params.get('end') ?? undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
