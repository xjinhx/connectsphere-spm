import { NextRequest, NextResponse } from 'next/server';
import { getLatestSafetyCheck } from '@/domain/safety-check/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-234 AC4, AC5 — the event's latest safety check (decision, note or
 * reason, who and when), or null. For the assigned coordinator and the Safety
 * Officer.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await getLatestSafetyCheck(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
