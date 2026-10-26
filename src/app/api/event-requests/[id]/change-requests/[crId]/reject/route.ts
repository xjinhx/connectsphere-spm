import { NextRequest, NextResponse } from 'next/server';
import { rejectChangeRequest } from '@/domain/change-request/service';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-191 — Reject a change request with a reason.
 *
 * AC1/AC3/AC4 are enforced inside rejectChangeRequest before anything is
 * written. The coordinator rejecting is whoever is signed in
 * (getCurrentActor), never an id sent in the request body — same reasoning
 * as the change-request POST route and every other actor-sensitive route in
 * this codebase.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; crId: string }> },
) {
  try {
    const { id, crId } = await params;
    const actor = await getCurrentActor();
    const body = await req.json().catch(() => {
      throw new ValidationError('The request body must be valid JSON.');
    });
    return NextResponse.json(await rejectChangeRequest(id, crId, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
