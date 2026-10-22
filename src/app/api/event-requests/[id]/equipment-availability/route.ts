import { NextRequest, NextResponse } from 'next/server';
import { checkEquipmentAvailability } from '@/domain/equipment-reservation/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * GET /api/event-requests/[id]/equipment-availability — SCRUM-167, check
 * every line of the event's equipment request over its commitment window
 * (F-1 to L). 200 with { availability }: the window and, per line, requested,
 * already reserved, available and shortfall (AC4). 400 when the event has no
 * approved venue booking (AC3).
 *
 * Technical Support Staff and the event's assigned coordinator, the people who
 * may open its equipment request; the service decides, since the second needs
 * the event (403 otherwise).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    const { id } = await params;
    return NextResponse.json({ availability: await checkEquipmentAvailability(id, actor) });
  } catch (error) {
    return handleApiError(error);
  }
}
