import { NextRequest, NextResponse } from 'next/server';
import { getReviewDetail } from '@/domain/review/service';
import { isActionPermitted } from '@/domain/identity/permissions';
import { ForbiddenError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-89 AC1/AC2/AC3 — open a submitted request and see everything the
 * Event Organiser provided; denied if it is assigned to another Coordinator.
 *
 * Only coordinators may review at all (the card's story is "As an Event
 * Coordinator"), checked through SCRUM-69's permission matrix before any data
 * is read — same pattern as the approve route. The narrower per-request check
 * (AC3, "requested directly by its identifier") happens in getReviewDetail,
 * which is what this route exposes.
 *
 * SCRUM-232 AC5: the Event Coordinator Lead (`coordinator_assignment`) may
 * also open this route read-only, same as the page — getReviewDetail decides
 * what that actually grants (view, never act) from `actor.roles`.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    if (
      !isActionPermitted(actor.roles, 'event_request_review') &&
      !isActionPermitted(actor.roles, 'coordinator_assignment')
    ) {
      throw new ForbiddenError('Your role does not permit this action: event_request_review.');
    }
    return NextResponse.json(await getReviewDetail(id, actor.userId, actor.roles));
  } catch (error) {
    return handleApiError(error);
  }
}
