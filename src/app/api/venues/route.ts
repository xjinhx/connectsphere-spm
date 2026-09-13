import { NextRequest, NextResponse } from 'next/server';
import { createVenue, listVenues } from '@/domain/venues/service';
import { VenueListQuerySchema } from '@/domain/venues/schema';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues
 *
 * GET  SCRUM-121 AC1 and AC3, the catalogue list
 * POST SCRUM-116 AC1 to AC4, SCRUM-117 AC1 and AC2, SCRUM-118 AC1
 *
 * Plumbing only: parse the request, call the service, let handleApiError map
 * domain errors onto status codes.
 */

export async function GET(request: NextRequest) {
  try {
    // TODO(SCRUM-69): once sign-in exists, refuse unless
    // canViewVenueCatalogue(currentUserRoles). There is no current-user helper
    // yet, so this is deliberately left open rather than faked as allow-all.

    const includeRetired = request.nextUrl.searchParams.get('includeRetired');
    const query = VenueListQuerySchema.safeParse(
      includeRetired === null ? {} : { includeRetired },
    );
    if (!query.success) {
      throw new ValidationError('includeRetired must be true or false.', query.error.flatten());
    }

    const venues = await listVenues(query.data.includeRetired);
    return NextResponse.json({ venues });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    // TODO(SCRUM-69): once sign-in exists, refuse unless
    // canManageVenues(currentUserRoles). Only Venue Staff may add a venue.

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const venue = await createVenue(body);
    return NextResponse.json({ venue }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
