import { NextRequest, NextResponse } from 'next/server';
import { createClientOrganisation, listClientOrganisations } from '@/domain/client-organisation/service';
import { handleApiError } from '@/lib/api/handler';
import { ValidationError } from '@/domain/shared/errors';

/**
 * /api/organisations
 *
 * GET  SCRUM-203 AC1 — the list an event request selects an organisation from
 * POST SCRUM-203 AC1, AC2 — create an organisation with a unique name
 */

export async function GET() {
  try {
    const organisations = await listClientOrganisations();
    return NextResponse.json({ organisations });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const organisation = await createClientOrganisation(body);
    return NextResponse.json({ organisation }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
