import { NextRequest, NextResponse } from 'next/server';
import { addEquipmentLine } from '@/domain/equipment-request/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * POST /api/event-requests/[id]/equipment-request/lines
 *
 * SCRUM-160 AC1 — add an equipment type and a quantity to the event's
 * equipment request.
 *
 * Only coordinators may record equipment (the card's story is "As an Event
 * Coordinator"), checked through SCRUM-69's permission matrix before the body
 * is read. The narrower rules - this event's assigned coordinator, while it is
 * Approved or in Planning - need the event row, so they are in the service.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_request');
    const body = await req.json();
    return NextResponse.json(await addEquipmentLine(id, actor.userId, body), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
