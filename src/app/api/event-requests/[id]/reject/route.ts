import { NextRequest, NextResponse } from 'next/server';
import { getRejectionView, rejectEventRequest } from '@/domain/review/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-93 AC4/AC6 — read the rejection reason and date on a request.
 * Who may read: canViewRejection (review/policy.ts) - the owner, the
 * assigned coordinator, or an Event Operations Manager, not anyone signed in.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await getRejectionView(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * SCRUM-93 AC4/AC5 — reject a submitted request with a reason.
 *
 * The Coordinator rejecting it is whoever is signed in (getCurrentActor),
 * never an id sent in the request body - same reasoning as the approve route.
 * Reuses 'event_request_approval' (see identity/permissions.ts's comment,
 * written when SCRUM-92 landed, anticipating this exact reuse).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'event_request_approval');
    const body = await req.json();
    return NextResponse.json(await rejectEventRequest(id, body, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
