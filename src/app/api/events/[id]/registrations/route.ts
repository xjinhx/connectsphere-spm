import { NextRequest, NextResponse } from 'next/server';
import { registerForEvent } from '@/domain/event-registration/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/events/[id]/registrations
 *
 * SCRUM-181 AC1: the signed-in Attendee registers for the event. Body:
 * { fullName, email, contactNumber }.
 *
 * 201 with the registration (the confirmation); 400 for a missing or invalid
 * field (AC1) or outside the registration period, with the start or end date
 * in the message (AC2, AC3, TC-181-06, TC-181-09); 401 with no session; 403
 * for any role but attendee; 404 for an event that takes no registrations;
 * 409 when already registered, with the existing registration in `details`
 * (AC5).
 *
 * The permission is checked first, before anything is read. The attendee is
 * whoever is signed in, never an id from the body.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_registration');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    return NextResponse.json(await registerForEvent(id, actor.userId, body), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
