import { NextRequest, NextResponse } from 'next/server';
import { recordEssentialArrangements } from '@/domain/essential-arrangements/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * PUT /api/event-requests/[id]/essential-arrangements
 *
 * SCRUM-100 AC1: the event's assigned coordinator records which arrangements
 * are essential. Body: { venue, equipment, technicalSupport, registration },
 * each 'essential' or 'not_required'. PUT because the set replaces the old one.
 *
 * 200 with the stored set; 400 for a missing or unknown arrangement or answer;
 * 401 with no session; 403 for any role but coordinator, or a coordinator the
 * event is not assigned to (TC-100-03); 409 when the event is not Approved or
 * in Planning (TC-100-04), including Confirmed (AC3, TC-100-08).
 *
 * The permission is checked first, before anything is read, the same as the
 * release route (SCRUM-231). The recorder is whoever is signed in.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'essential_arrangements_record');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    return NextResponse.json(await recordEssentialArrangements(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
