import { NextRequest, NextResponse } from 'next/server';
import { getApprovalView } from '@/domain/review/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-92 AC2 / AC3 — the approval outcome, its date, and the statement that
 * nothing is yet committed. Readable by any signed-in user (Jira AC3:
 * "anyone"); the middleware refuses it without a session.
 *
 * SCRUM-72 AC2 — the actor is fetched so getApprovalView can refuse an
 * Attendee-only account requesting this directly.
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
