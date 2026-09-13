import { NextResponse } from 'next/server';
import { getVenueFormOptions } from '@/domain/venues/service';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/options
 *
 * Everything the add and edit venue forms need to fill their dropdowns: the
 * maintained location list (SCRUM-116 AC1), the facility and accessibility
 * reference lists (SCRUM-117 AC1 and AC2), plus the fixed operating slots
 * (SCRUM-116 AC4) and room layouts (SCRUM-118 AC1).
 *
 * A static segment wins over the dynamic one, so this does not collide with
 * /api/venues/[id].
 */

export async function GET() {
  try {
    // TODO(SCRUM-69): refuse unless canManageVenues(currentUserRoles). These
    // lists only matter to the people who maintain the catalogue.
    const options = await getVenueFormOptions();
    return NextResponse.json({ options });
  } catch (error) {
    return handleApiError(error);
  }
}
