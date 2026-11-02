import { NextRequest, NextResponse } from 'next/server';
import { assertPermission } from '@/domain/identity/policy';
import { getEventSchedule, reconfirmArrangement } from '@/domain/significant-change/service';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * GET /api/event-requests/[id]/arrangement-reviews
 *
 * SCRUM-111 AC6, AC7, AC8: the event's confirmed venue bookings and reserved
 * equipment, each with its review-required flag, the time it was set, its
 * cause, and the latest re-confirmation. For the assigned coordinator and the
 * Event Coordinator Lead; 403 for anyone else.
 *
 * POST /api/event-requests/[id]/arrangement-reviews
 *
 * SCRUM-111 AC9: the assigned coordinator re-confirms one flagged arrangement.
 * Body: { kind: 'venue_booking' | 'equipment_reservation', id }. 200 with the
 * arrangement, its flag cleared and who and when saved; 400 for an invalid
 * body; 403 for anyone but the assigned coordinator; 404 for an arrangement
 * that is not this event's; 409 when it is not flagged, or the event is
 * Completed or Cancelled.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    const { id } = await params;
    const { bookings, reservations } = await getEventSchedule(id, actor);
    return NextResponse.json({ bookings, reservations });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_schedule_change');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    return NextResponse.json(await reconfirmArrangement(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
