import { NextRequest, NextResponse } from 'next/server';
import { reserveEquipment } from '@/domain/equipment-reservation/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * POST /api/event-requests/[id]/equipment-request/lines/[lineId]/reservation
 * — SCRUM-173, reserve units of one line's item for the event's whole
 * commitment window. Body: { quantity }.
 *
 * 201 with { reservation } (AC1, AC3, AC5). 400 when the event has no
 * approved venue booking (AC2) or the quantity is more than the line still
 * needs; 409 when fewer units are available (AC4), nothing reserved, with
 * details { available, offer }: SCRUM-175's partial reservation of what is
 * available and the shortfall, or null when none are available.
 *
 * Technical Support Staff only (equipment_administration, SCRUM-69's matrix),
 * checked before the body is read.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_administration');
    const { id, lineId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const reservation = await reserveEquipment(id, lineId, actor.userId, body);
    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
