import { NextRequest, NextResponse } from 'next/server';
import { createEventRequest, listMyEventRequests } from '@/domain/event-request/service';
import { handleApiError } from '@/lib/api/handler';

/** SCRUM-82 AC3 — the signed-in organiser's own event requests. */
export async function GET() {
  try {
    return NextResponse.json(await listMyEventRequests());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventRequest = await createEventRequest(body);
    return NextResponse.json(eventRequest, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
