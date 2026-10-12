import { NextRequest, NextResponse } from 'next/server';
import { createVenueHold, listActiveVenueHolds } from '@/domain/venue-hold/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { VenueIdSchema } from '@/domain/venues/schema';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/venues/[id]/holds (SCRUM-227 Hold a venue until an expiry)
 *
 * GET  the venue's active holds from today on, each with its event and
 *      expiry. 200 with { holds }.
 * POST AC1: hold a period for an event until an expiry. Body:
 *      { eventRequestId, date: 'YYYY-MM-DD', start: 'HH:MM', end: 'HH:MM',
 *        expiresAt: 'YYYY-MM-DDTHH:MM' (Singapore time) }.
 *      201 with { hold }. 400 for AC2 (no expiry, or one not in the future)
 *      and other invalid input, 404 for a venue or event that does not exist,
 *      409 when the period is already booked, held or unavailable (customer
 *      #41), naming each.
 *
 * Both need venue_administration (Venue Staff), checked before anything else
 * (SCRUM-69 AC3): the story is Venue Staff's, and the list names events.
 */

function parseVenueId(id: string): string {
  const parsed = VenueIdSchema.safeParse(id);
  if (!parsed.success) throw new ValidationError('Venue id must be a valid id.', { id });
  return parsed.data;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

    const { id } = await params;
    const holds = await listActiveVenueHolds(parseVenueId(id));
    return NextResponse.json({ holds });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const hold = await createVenueHold(parseVenueId(id), body, actor.userId);
    return NextResponse.json({ hold }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
