import { NextRequest, NextResponse } from 'next/server';
import { updateEquipmentRequestStatus } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * /api/event-requests/[id]/equipment-request/status
 *
 * SCRUM-166 — Update the status of an equipment request.
 *
 * PUT { status, unavailableLineIds?, reason? }: Technical Support Staff
 * (equipment_administration) set the request's status (AC2), with the
 * unavailable items for partially fulfilled (AC3) and the reason for unable to
 * fulfil (AC4). The role is checked here before the body is read, and again in
 * the service; the rules for each status are in the service. Returns the
 * request as it now reads.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission([...actor.roles], 'equipment_administration');
    const body = await req.json();
    return NextResponse.json(await updateEquipmentRequestStatus(id, actor, body));
  } catch (error) {
    return handleApiError(error);
  }
}
