import { NextRequest, NextResponse } from 'next/server';
import { getApprovalView } from '@/domain/review/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-92 AC2 / AC3 — the approval outcome, its date, and the statement that
 * nothing is yet committed. Readable by the request's owner, its coordinator
 * and Operations Managers; everyone else gets 403 (canViewApproval, customer
 * clarification #91). The middleware refuses it without a session.
 *
 * The actor is fetched so getApprovalView can decide who is asking, including
 * refusing an Attendee-only account (SCRUM-72 AC2).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await getApprovalView(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
