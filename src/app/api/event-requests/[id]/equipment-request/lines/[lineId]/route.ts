import { NextRequest, NextResponse } from 'next/server';
import { removeEquipmentLine, updateEquipmentLineQuantity } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * /api/event-requests/[id]/equipment-request/lines/[lineId]
 *
 * SCRUM-160 AC7 — change a line's quantity (PATCH) or remove it (DELETE),
 * saved immediately.
 *
 * AC8 — a reduction of a reserved item is refused with 409 and the reservation
 * warning until it is confirmed: confirmReservationChange: true in the PATCH
 * body, or ?confirmReservationChange=true on the DELETE.
 *
 * Same split as adding a line: the role is checked here through SCRUM-69's
 * matrix before the body is read, and the rules that need the event are in
 * the service.
 */

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id, lineId } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_request');
    const body = await req.json();
    return NextResponse.json(await updateEquipmentLineQuantity(id, lineId, actor.userId, body));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id, lineId } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_request');
    const confirmReservationChange = req.nextUrl.searchParams.get('confirmReservationChange') === 'true';
    await removeEquipmentLine(id, lineId, actor.userId, { confirmReservationChange });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}
