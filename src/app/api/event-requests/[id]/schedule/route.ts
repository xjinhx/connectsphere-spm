import { NextRequest, NextResponse } from 'next/server';
import { assertPermission } from '@/domain/identity/policy';
import { changeEventSchedule } from '@/domain/significant-change/service';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * PUT /api/event-requests/[id]/schedule
 *
 * SCRUM-111 AC1, AC2, AC4, AC5: the event's assigned coordinator changes its
 * date, times, expected attendance or venue requirements. Body:
 * { proposedDate, startTime, endTime, expectedAttendance, roomLayout,
 *   accessibilityRequired, accessibilityNotes, acknowledged }.
 *
 * 200 with the saved values and how many arrangements were flagged; 400 for an
 * invalid field, naming it; 401 with no session; 403 for any role but
 * coordinator, or a coordinator the event is not assigned to; 409 when an
 * affected arrangement was not acknowledged (details.acknowledgementRequired,
 * with the bookings and reservations it affects; nothing saved), when the
 * event is Completed or Cancelled, or when it was saved by someone else
 * meanwhile.
 *
 * The permission is checked first, before anything is read, the same as the
 * SCRUM-110 information route.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json(await changeEventSchedule(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
