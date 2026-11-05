import { NextRequest, NextResponse } from 'next/server';
import { getChangeRequestDetail } from '@/domain/change-request/service';
import { NotFoundError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-188 AC1 — open one change request (from its notification or from
 * the event page) and see the current value and the requested value for
 * each field, plus the organiser's reason.
 *
 * Who may read is decided entirely inside getChangeRequestDetail
 * (isCurrentCoordinator): the event request id in the URL is only used here
 * to keep the link's two ids in agreement, never to grant access on its own.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; crId: string }> },
) {
  try {
    const { id, crId } = await params;
    const actor = await getCurrentActor();
    const detail = await getChangeRequestDetail(crId, actor.userId);
    if (detail.eventRequestId !== id) {
      // The URL's two ids disagree - same as any other id that doesn't
      // belong to this parent, nothing is disclosed about which part is wrong.
      throw new NotFoundError('Change request');
    }
    return NextResponse.json(detail);
  } catch (error) {
    return handleApiError(error);
  }
}
