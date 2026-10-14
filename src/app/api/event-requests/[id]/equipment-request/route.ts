import { NextRequest, NextResponse } from 'next/server';
import { getEquipmentRequest, saveTechnicalRequirements } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * /api/event-requests/[id]/equipment-request
 *
 * SCRUM-160 — the event's equipment request, read from the stored rows.
 *
 * GET: who may read it depends on the event (its assigned coordinator), so
 * the check is in getEquipmentRequest, which reads the event anyway.
 *
 * PATCH: AC5 - save the request's free-text technical requirements. The role
 * is checked here before the body is read; the assigned-coordinator and
 * status rules are in the service, as for the lines.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    return NextResponse.json(await getEquipmentRequest(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_request');
    const body = await req.json();
    return NextResponse.json(await saveTechnicalRequirements(id, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}
