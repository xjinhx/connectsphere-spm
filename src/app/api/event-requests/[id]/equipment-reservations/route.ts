import { NextRequest, NextResponse } from 'next/server';
import { listEventReservations } from '@/domain/equipment-reservation/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * GET /api/event-requests/[id]/equipment-reservations — SCRUM-173 AC6 and
 * AC7, the event's equipment section. 200 with { reservations, outstanding }:
 * every reservation with its item, quantity, window and status, and the lines
 * still to reserve, on their own.
 *
 * Technical Support Staff and the event's assigned coordinator; the service
 * decides (403 otherwise).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    const { id } = await params;
    return NextResponse.json(await listEventReservations(id, actor));
  } catch (error) {
    return handleApiError(error);
  }
}
