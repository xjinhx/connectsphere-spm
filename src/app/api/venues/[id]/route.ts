import { NextRequest, NextResponse } from 'next/server';
import { getVenue, updateVenue } from '@/domain/venues/service';
import { VenueIdSchema } from '@/domain/venues/schema';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/[id]
 *
 * GET   SCRUM-121 AC2, the full venue page
 * PATCH SCRUM-120 AC1, SCRUM-117 AC3, SCRUM-118
 *
 * PATCH rather than PUT: a field left out is left unchanged. A list that is
 * sent replaces the whole list, which is how a facility gets removed.
 */

function parseVenueId(id: string): string {
  const parsed = VenueIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError('Venue id must be a valid id.', { id });
  }
  return parsed.data;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO(SCRUM-69): refuse unless canViewVenueCatalogue(currentUserRoles).
    const { id } = await params;
    const venue = await getVenue(parseVenueId(id));
    return NextResponse.json({ venue });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // TODO(SCRUM-69): refuse unless canManageVenues(currentUserRoles).
    const { id } = await params;
    const venueId = parseVenueId(id);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    // TODO(SCRUM-148): when confirmed bookings exist, SCRUM-120 AC2 requires
    // listing the affected bookings and refusing until the caller sends
    // confirmAffectedBookings. The field is already accepted by the schema.
    const venue = await updateVenue(venueId, body);
    return NextResponse.json({ venue });
  } catch (error) {
    return handleApiError(error);
  }
}
