import { NextRequest, NextResponse } from 'next/server';
import { getEquipmentRequest } from '@/domain/equipment-request/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * /api/event-requests/[id]/equipment-request
 *
 * SCRUM-160 — the event's equipment request, read from the stored rows.
 *
 * GET: who may read it depends on the event (its assigned coordinator), so
 * the check is in getEquipmentRequest, which reads the event anyway.
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
