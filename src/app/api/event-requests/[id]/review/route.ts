import { NextRequest, NextResponse } from 'next/server';
import { getReviewDetail } from '@/domain/review/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-89 AC1/AC2 — open a submitted request and see everything the Event
 * Organiser provided.
 *
 * Only coordinators may review (the card's story is "As an Event
 * Coordinator"), checked through SCRUM-69's permission matrix before any data
 * is read — same pattern as the approve route. No per-request assignment
 * check: US-7.1 (this story's real consolidated pairing, per
 * ConnectSphere_Test_Cases_v3.xlsx) carries no AC restricting viewing by
 * assignment — see the note on getReviewDetail.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_request_review');
    return NextResponse.json(await getReviewDetail(id));
  } catch (error) {
    return handleApiError(error);
  }
}
