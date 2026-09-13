import { NextRequest, NextResponse } from 'next/server';
import { getEventRequest, updateEventRequestDetails } from '@/domain/event-request/service';
import { handleApiError } from '@/lib/api/handler';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getEventRequest(id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    return NextResponse.json(await updateEventRequestDetails(id, body));
  } catch (error) {
    return handleApiError(error);
  }
}
