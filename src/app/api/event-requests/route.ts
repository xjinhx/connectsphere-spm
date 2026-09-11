import { NextRequest, NextResponse } from 'next/server';
import { createEventRequest } from '@/domain/event-request/service';
import { handleApiError } from '@/lib/api/handler';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventRequest = await createEventRequest(body);
    return NextResponse.json(eventRequest, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
