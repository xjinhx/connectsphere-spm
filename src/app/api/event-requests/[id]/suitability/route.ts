import { NextRequest, NextResponse } from 'next/server';
import { checkVenueSuitability } from '@/domain/suitability/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * POST /api/event-requests/[id]/suitability — SCRUM-135 and SCRUM-136, check a
 * selected venue against the event (Body: { venueId }), or for one of its
 * booking requests at that request's venue (Body: { bookingRequestId },
 * SCRUM-136 AC5). 200 with { result }: the verdict, each requirement with the
 * event's and the venue's values, and when it was run. Each run is stored, so
 * the coordinator's review page can show it again without running it
 * (SCRUM-135 AC3).
 *
 * Coordinators only (venue_booking_request, the permission for asking for a
 * venue, which this check comes before), checked before anything is read; the
 * event's own assigned coordinator only, checked by the service once it has
 * read the event (403 otherwise), as for a booking request (SCRUM-142 AC4).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_booking_request');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const result = await checkVenueSuitability(id, body, actor.userId);
    return NextResponse.json({ result });
  } catch (error) {
    return handleApiError(error);
  }
}
