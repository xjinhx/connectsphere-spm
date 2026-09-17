import { NextRequest, NextResponse } from 'next/server';
import { getClarificationView, requestClarification } from '@/domain/review/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * US-7.2 AC1/AC3 — read the clarification note on a request. Anyone signed in
 * may read it (Jira: "visible to the Organiser" / "anyone with access"), same
 * reasoning as the approval route — no role check, the middleware already
 * requires a session.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getClarificationView(id));
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
    const body = await req.json();
    return NextResponse.json(await requestClarification(id, body, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
