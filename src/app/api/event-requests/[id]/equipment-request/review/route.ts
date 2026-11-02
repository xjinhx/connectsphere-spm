import { NextResponse } from 'next/server';
import { completeEquipmentReview } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * /api/event-requests/[id]/equipment-request/review
 *
 * SCRUM-171 — Assess whether requested equipment is suitable for the event.
 *
 * POST: Technical Support Staff (equipment_administration) complete the
 * suitability review. When every requested item is marked suitable and is
 * available for the commitment window, the request is marked ready to reserve
 * (AC4); otherwise it is not, and the response says why. The role is checked
 * here, and again in the service. Returns { request, notReady }.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission([...actor.roles], 'equipment_administration');
    return NextResponse.json(await completeEquipmentReview(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
