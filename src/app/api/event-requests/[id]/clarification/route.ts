import { NextRequest, NextResponse } from 'next/server';
import { getClarificationView, requestClarification } from '@/domain/review/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * US-7.2 AC1/AC3 — read the clarification note on a request.
 *
 * Who may read it is decided in getClarificationView: the owning Organiser, a
 * Coordinator entitled to review the request, or an Event Operations Manager
 * (canViewClarification), and an Attendee-only account is refused outright
 * (SCRUM-72 AC1/AC2). It used to be any signed-in account, which let anyone
 * read any request's note and status by id. The actor is fetched here so both
 * rules have something to judge.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await getClarificationView(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * SCRUM-90 AC1/AC3 — request clarification on a submitted request.
 *
 * The Coordinator raising it is whoever is signed in (getCurrentActor), never
 * an id sent in the request body — same reasoning as the approve route.
 * Only coordinators may request clarification, checked through SCRUM-69's
 * permission matrix before any data is read.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_request_clarification');
    // A body that is not JSON is the caller's mistake, not a server fault:
    // req.json() throws a SyntaxError, which handleApiError can only report as
    // a 500. Turned into the ValidationError it is, so it answers 400 like
    // every other bad input on this route.
    const body = await req.json().catch(() => {
      throw new ValidationError('The request body must be valid JSON.');
    });
    return NextResponse.json(await requestClarification(id, body, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
