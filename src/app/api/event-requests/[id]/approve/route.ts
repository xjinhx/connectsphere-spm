import { NextRequest, NextResponse } from 'next/server';
import { approveEventRequest } from '@/domain/review/service';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-92 AC1 — approve a submitted request.
 *
 * TODO(SCRUM-68): the body carries the approving coordinator's id because
 * getCurrentActor() throws until Authentication lands. Once it does, take the
 * actor from the session and stop trusting the body.
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
