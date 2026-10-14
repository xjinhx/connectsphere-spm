import { NextRequest, NextResponse } from 'next/server';
import { markPeriodUnavailable } from '@/domain/availability/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * POST /api/venues/[id]/unavailable-slots
 *
 * SCRUM-239 AC6 (SCRUM-151 AC1 in times): Venue Staff mark a period of a
 * venue unavailable on one date, with a reason.
 * Body: { date: 'YYYY-MM-DD', start: '14:00', end: '16:30', reason }.
 * SCRUM-151 AC2: the coordinator of each confirmed booking overlapping it is
 * notified in the same save. The path keeps its name, as the table does.
 *
 * 201 with { unavailablePeriods, notifiedBookings }. 400 for a period outside
 * the venue's opening hours. 409 if it overlaps a period already unavailable,
 * in which case nothing is saved and nobody is notified. 404 for a venue that
 * does not exist.
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

    const outcome = await markPeriodUnavailable(id, body, actor.userId);
    return NextResponse.json(outcome, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
