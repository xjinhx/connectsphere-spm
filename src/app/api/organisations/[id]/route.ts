import { NextRequest, NextResponse } from 'next/server';
import { getClientOrganisation, updateClientOrganisation } from '@/domain/client-organisation/service';
import { handleApiError } from '@/lib/api/handler';
import { ValidationError } from '@/domain/shared/errors';

/**
 * /api/organisations/[id]
 *
 * GET   SCRUM-203 AC3 — an organisation and its events
 * PATCH SCRUM-203 — "create and update a client organisation record"
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const organisation = await getClientOrganisation(id);
    return NextResponse.json({ organisation });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const organisation = await updateClientOrganisation(id, body);
    return NextResponse.json({ organisation });
  } catch (error) {
    return handleApiError(error);
  }
}
