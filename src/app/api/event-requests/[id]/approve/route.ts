import { NextRequest, NextResponse } from 'next/server';
import { approveEventRequest } from '@/domain/review/service';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-92 AC1 — approve a submitted request.
 *
 * The middleware already refuses this route without a signed-in session.
 * TODO: the body still carries the approving coordinator's id, because
 * getCurrentActor() is not implemented on main yet (the working version is on
 * the event-request branch, SCRUM-76). Once it lands, read the actor from the
 * session here and pass actor.userId to approveEventRequest instead.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    return NextResponse.json(await approveEventRequest(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
