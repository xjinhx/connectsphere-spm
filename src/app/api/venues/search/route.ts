import { NextRequest, NextResponse } from 'next/server';
import { searchVenues } from '@/domain/venues/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/search?date=YYYY-MM-DD&start=HH:MM&end=HH:MM
 *   [&minCapacity=N][&layout=theatre][&location=<id>][&facility=<id>...][&accessibility=<id>...]
 *
 * GET SCRUM-239 AC2: the venues open and free for the whole period on the date
 *     (replacing SCRUM-128's slots).
 *     Needs venue_catalogue_view, the same as browsing the catalogue it
 *     searches, so Event Organisers and Attendees are refused.
 *     SCRUM-130: narrowed by capacity, layout, facilities, location and
 *     accessibility features; a value that is not a whole number above 0, a
 *     layout or an id not on the maintained lists is a ValidationError (400).
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
      // SCRUM-130: the filters, all optional. Facilities and accessibility
      // features may be repeated (&facility=<id>&facility=<id>).
      minCapacity: params.get('minCapacity') ?? undefined,
      layout: params.get('layout') ?? undefined,
      locationId: params.get('location') ?? undefined,
      facilityIds: params.getAll('facility'),
      accessibilityFeatureIds: params.getAll('accessibility'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
