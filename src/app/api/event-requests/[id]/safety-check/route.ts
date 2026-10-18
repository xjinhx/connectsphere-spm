import { NextRequest, NextResponse } from 'next/server';
import { getSafetyCheckView, recordSafetyCheckDecision } from '@/domain/safety-check/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/** SCRUM-234 AC2 — what the Safety Officer checks an event against, and its earlier checks. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await getSafetyCheckView(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * SCRUM-234 AC3, AC4 — record the Safety Officer's decision:
 * { decision: 'approved' | 'changes_requested' | 'rejected', note?: string }.
 *
 * The Safety Officer deciding is whoever is signed in (getCurrentActor), never
 * an id sent in the body. AC6: anyone else is refused (403) before the event
 * is read.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    const body = await req.json().catch(() => ({}));
    return NextResponse.json(await recordSafetyCheckDecision(id, body, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
