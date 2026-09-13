import { NextRequest, NextResponse } from 'next/server';
import { updateEventRequestDraft } from '@/domain/event-request/service';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-83 AC4 — saving again while editing a draft updates the same draft.
 * SCRUM-85 AC3 — the save behind resumed editing.
 *
 * Refuses a request that is no longer a draft, so a direct call cannot edit a
 * submitted request that the page already refuses to show an edit form for.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    return NextResponse.json(await updateEventRequestDraft(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
