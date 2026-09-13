import { NextResponse } from 'next/server';
import { getClientOrganisation } from '@/domain/client-organisation/service';
import { handleApiError } from '@/lib/api/handler';

/** /api/organisations/[id] — SCRUM-203 AC3, an organisation and its events. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const organisation = await getClientOrganisation(id);
    return NextResponse.json({ organisation });
  } catch (error) {
    return handleApiError(error);
  }
}
