import { NextRequest, NextResponse } from 'next/server';
import { saveEquipmentSuitability } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * /api/event-requests/[id]/equipment-request/suitability
 *
 * SCRUM-171 — Assess whether requested equipment is suitable for the event.
 *
 * PUT { verdicts: [{ lineId, suitability: 'suitable' | 'not_suitable' | null, reason? }] }:
 * Technical Support Staff (equipment_administration) mark each requested item
 * suitable or not suitable and record why (AC1). An item marked not suitable is
 * then an unmet requirement on the request, with the reason (AC2). The role is
 * checked here before the body is read, and again in the service; the rules
 * are in the service. Returns the request as it now reads.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission([...actor.roles], 'equipment_administration');
    const body = await req.json();
    return NextResponse.json(await saveEquipmentSuitability(id, actor, body));
  } catch (error) {
    return handleApiError(error);
  }
}
