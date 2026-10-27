import { NextRequest, NextResponse } from 'next/server';
import { updateEventInformation } from '@/domain/event-information/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * PUT /api/event-requests/[id]/information
 *
 * SCRUM-110 AC1: the event's assigned coordinator saves its description,
 * internal notes and client contact. Body: { description, internalNotes,
 * clientContactName, clientContactEmail, clientContactPhone }; blank optional
 * fields are stored as empty. PUT because the five fields are replaced together.
 *
 * 200 with the stored fields; 400 for an invalid field, naming it (e.g. an
 * email that is not an address, TC-110-04); 401 with no session; 403 for any
 * role but coordinator (AC2-AC4: organisers never edit here), or a coordinator
 * the event is not assigned to (TC-110-03); 409 for a Completed or Cancelled
 * event (AC5, TC-110-11).
 *
 * The permission is checked first, before anything is read, the same as the
 * essential-arrangements route (SCRUM-100).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_information_edit');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    return NextResponse.json(await updateEventInformation(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
