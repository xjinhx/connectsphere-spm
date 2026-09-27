import { NextRequest, NextResponse } from 'next/server';
import { markSlotsUnavailable } from '@/domain/availability/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/venues/[id]/unavailable-slots
 *
 * SCRUM-151 AC1: Venue Staff mark one or more slots of a venue unavailable on
 * one date, with a reason. Body: { date: 'YYYY-MM-DD', slots: ['am', 'pm'], reason }.
 *
 * 201 with the recorded slots. 409 if one of them is already unavailable, in
 * which case nothing is saved. 404 for a venue that does not exist.
 *
 * Needs venue_administration, checked before anything else (SCRUM-69 AC3).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_administration');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const unavailableSlots = await markSlotsUnavailable(id, body, actor.userId);
    return NextResponse.json({ unavailableSlots }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
