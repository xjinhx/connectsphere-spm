import { NextRequest, NextResponse } from 'next/server';
import { getCoordinatorOverview } from '@/domain/assignment/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-233 — one view of every coordinator's assigned events, for the Event
 * Coordinator Lead to balance workload and spot events that need
 * reassigning.
 *
 * AC4 — gated by `coordinator_assignment` inside getCoordinatorOverview, the
 * same permission SCRUM-94/96's assign and reassign routes use, so a caller
 * without the Lead role gets 403 before anything is read.
 */
export async function GET(_req: NextRequest) {
  try {
    const actor = await getCurrentActor();
    return NextResponse.json(await getCoordinatorOverview(actor));
  } catch (error) {
    return handleApiError(error);
  }
}
