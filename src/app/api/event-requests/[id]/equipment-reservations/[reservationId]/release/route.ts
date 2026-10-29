import { NextRequest, NextResponse } from 'next/server';
import { releaseEquipmentReservation } from '@/domain/equipment-reservation/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * POST /api/event-requests/[id]/equipment-reservations/[reservationId]/release
 * — SCRUM-177, release one of the event's reservations. Body: { reason }.
 *
 * 200 with { reservation }, now Released with its reason and date (AC1). 400
 * when the reason is missing or blank; 404 when the reservation is not the
 * event's; 409 when it is already released, nothing changed.
 *
 * Technical Support Staff only (equipment_administration, the same as
 * reserving), checked before the body is read.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reservationId: string }> },
) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_administration');
    const { id, reservationId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const reservation = await releaseEquipmentReservation(id, reservationId, actor.userId, body);
    return NextResponse.json({ reservation });
  } catch (error) {
    return handleApiError(error);
  }
}
