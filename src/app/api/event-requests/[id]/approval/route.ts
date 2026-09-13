import { NextRequest, NextResponse } from 'next/server';
import { getApprovalView } from '@/domain/review/service';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-92 AC2 / AC3 — the approval outcome, its date, and the statement that
 * nothing is yet committed. Readable by any signed-in user (Jira AC3:
 * "anyone"); the middleware refuses it without a session.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getApprovalView(id));
  } catch (error) {
    return handleApiError(error);
  }
}
