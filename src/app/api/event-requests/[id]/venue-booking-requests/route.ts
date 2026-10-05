import { NextRequest, NextResponse } from 'next/server';
import { submitVenueBookingRequest } from '@/domain/venue-booking/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-142 AC1-AC4 — submit a venue booking request for an event.
 *
 * The requesting coordinator is whoever is signed in (getCurrentActor), never
 * an id sent in the request body — same reasoning as the approve and reject
 * routes. Only coordinators may request a venue (the card's story is "As an
 * Event Coordinator"), checked through SCRUM-69's permission matrix before
 * anything is read.
 *
 * The narrower rule — not just any coordinator, but the one this event is
 * assigned to (AC4) — is in submitVenueBookingRequest rather than here, the
 * same pattern as approveEventRequest and SCRUM-213: it needs the event's
 * current coordinator, which means reading the row, and the service reads it
 * already.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'venue_booking_request');
    const body = await req.json();
    return NextResponse.json(await submitVenueBookingRequest(id, actor.userId, body), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
