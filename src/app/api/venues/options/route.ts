import { NextResponse } from 'next/server';
import { getVenueFormOptions } from '@/domain/venues/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/options
 *
 * Everything the add and edit venue forms need to fill their dropdowns: the
 * maintained location list (SCRUM-116 AC1), the facility and accessibility
 * reference lists (SCRUM-117 AC1 and AC2), plus the fixed operating slots
 * (SCRUM-116 AC4) and room layouts (SCRUM-118 AC1).
 *
 * Needs venue_administration: these lists only serve the add and edit forms,
 * which only Venue Staff can use.
 *
 * A static segment wins over the dynamic one, so this does not collide with
 * /api/venues/[id].
 */

export async function GET() {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

    const options = await getVenueFormOptions();
    return NextResponse.json({ options });
  } catch (error) {
    return handleApiError(error);
  }
}
