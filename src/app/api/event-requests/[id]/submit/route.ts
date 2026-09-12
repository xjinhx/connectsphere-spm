import { NextRequest, NextResponse } from 'next/server';
import { submitEventRequest } from '@/domain/event-request/service';
import { handleApiError } from '@/lib/api/handler';

/** SCRUM-82 AC1/AC2 — submit a draft. A refusal names each incomplete field. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await submitEventRequest(id));
  } catch (error) {
    return handleApiError(error);
  }
}
