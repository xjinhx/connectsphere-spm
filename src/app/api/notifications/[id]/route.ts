import { NextRequest, NextResponse } from 'next/server';
import { markAsRead } from '@/domain/notification/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/notifications/[id]
 *
 * PATCH SCRUM-193 AC3: opening a notification marks it read. No permission
 * check: markAsRead (service.ts) refuses with 404, not 403, for a
 * notification that is not the actor's own - the same reasoning as every
 * other "not yours" read in this codebase (SCRUM-89 AC4), so a stranger
 * learns nothing about whether the id exists.
 */
export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    const { id } = await params;

    const notification = await markAsRead(id, actor.userId);
    return NextResponse.json({ notification });
  } catch (error) {
    return handleApiError(error);
  }
}
