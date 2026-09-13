import { NextRequest, NextResponse } from 'next/server';
import { createVenue, listVenues } from '@/domain/venues/service';
import { VenueListQuerySchema } from '@/domain/venues/schema';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues
 *
 * GET  SCRUM-121 AC1 and AC3, the catalogue list. Needs venue_catalogue_view.
 * POST SCRUM-116 AC1 to AC4, SCRUM-117 AC1 and AC2, SCRUM-118 AC1. Needs
 *      venue_administration, so only Venue Staff (SCRUM-116 AC1 "Given I am
 *      Venue Staff").
 *
 * Permission is checked before anything is parsed or read, as SCRUM-69 AC3
 * asks, so a refused caller never gets a partial result. A refusal is a
 * ForbiddenError, which handleApiError turns into 403.
 */

export async function GET(request: NextRequest) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_catalogue_view');

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
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

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
