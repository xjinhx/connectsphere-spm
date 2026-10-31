import { NextRequest, NextResponse } from 'next/server';
import { updateRegistrationSettings } from '@/domain/registration-list/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * PUT /api/event-requests/[id]/registration-settings
 *
 * SCRUM-185 AC5: the event's assigned coordinator saves its registration
 * start date, end date and capacity. Body: { startDate, endDate, capacity },
 * dates as YYYY-MM-DD. PUT because the three are replaced together.
 *
 * 200 with the stored settings; 400 for an invalid field, naming it (AC6: an
 * end date before the start date, or a capacity above the largest venue
 * capacity); 401 with no session; 403 for any role but coordinator, or a
 * coordinator the event is not assigned to; 409 when the event is not
 * Confirmed.
 *
 * The permission is checked first, before anything is read, the same as the
 * event-information route (SCRUM-110).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'registration_settings_edit');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    return NextResponse.json(await updateRegistrationSettings(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
