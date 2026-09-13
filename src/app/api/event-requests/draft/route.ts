import { NextRequest, NextResponse } from 'next/server';
import { saveEventRequestDraft } from '@/domain/event-request/service';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-83 AC1 — "Save as draft": stores whatever has been filled in.
 *
 * A separate endpoint from POST /api/event-requests deliberately. That one is
 * SCRUM-76's "Save request", which applies US-5.1 AC5's mandatory-field rule;
 * this one is the action US-6.1 AC1 describes, where that rule does not apply.
 * Two actions, two endpoints, rather than one endpoint with a mode flag that
 * silently changes how strict it is.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const draft = await saveEventRequestDraft(body);
    return NextResponse.json(draft, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
