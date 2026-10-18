import { NextResponse } from 'next/server';
import { listEquipmentQueue } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * GET /api/equipment-queue
 *
 * SCRUM-164 — the queue of equipment requests awaiting review: every
 * outstanding request, at every location (AC1, AC3, AC4, AC5).
 *
 * Technical Support Staff only (equipment_administration), checked before
 * anything is read; any other role gets 403 with no request data (TC-164-03).
 */
export async function GET() {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_administration');
    return NextResponse.json(await listEquipmentQueue());
  } catch (error) {
    return handleApiError(error);
  }
}
