import { NextRequest, NextResponse } from 'next/server';
import {
  getClarificationExchange,
  respondToClarification,
} from '@/domain/clarification/service';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-91 — the Organiser's side of the clarification exchange.
 *
 * Named `clarification-rounds`, not `clarifications`, so it cannot be misread
 * as SCRUM-90's existing `/clarification` route: one letter apart would be a
 * trap in review and when tracing a requirement to its code. That route keeps
 * serving the single current note it was built for; this one serves the rounds.
 */

/**
 * AC2/AC3 — the exchange as it stands: every round, oldest first, each with the
 * note it was raised with and the response it received. The amended values are
 * on the event request itself and are read through the existing request read.
 *
 * Anyone signed in may read it, matching SCRUM-90's clarification route — the
 * middleware already requires a session.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getClarificationExchange(id));
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * AC1 — answer the open clarification and send the request back for review.
 *
 * The responder is whoever is signed in (getCurrentActor), never an id sent in
 * the body — the same reasoning as the approve and clarification routes. No
 * assertPermission call: this is not a matrix permission but an ownership
 * question ("is this my request"), which the service answers with
 * isOwnRequest().
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = await getCurrentActor();
    const body = await req.json();
    return NextResponse.json(await respondToClarification(id, body, actor.userId));
  } catch (error) {
    return handleApiError(error);
  }
}
