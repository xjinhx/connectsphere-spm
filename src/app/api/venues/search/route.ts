import { NextRequest, NextResponse } from 'next/server';
import { searchVenues } from '@/domain/venues/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/search?date=YYYY-MM-DD&slots=am&slots=pm
 *
 * GET SCRUM-128 AC1 to AC5: the venues free in every selected slot on the date.
 *     Needs venue_catalogue_view, the same as browsing the catalogue it
 *     searches, so Event Organisers and Attendees are refused.
 *
 * Permission is checked before anything is parsed or read (SCRUM-69 AC3). A
 * missing or invalid date, or no slot selected, is a ValidationError: 400.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_catalogue_view');

    const params = request.nextUrl.searchParams;
    const result = await searchVenues({
      date: params.get('date') ?? undefined,
      slots: params.getAll('slots'),
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleApiError(error);
  }
}
