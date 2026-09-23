import { NextRequest, NextResponse } from 'next/server';
import { listOrganisersForOrganisation } from '@/domain/identity/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-204 AC1 — the Event Organiser accounts linked to this organisation,
 * for the Coordinator-facing organisation page. Same permission as
 * /api/accounts/[id]/organisation, since it's the same membership.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { roles: callerRoles } = await getCurrentActor();
    assertPermission(callerRoles, 'organisation_membership_management');
    const { id } = await params;
    const organisers = await listOrganisersForOrganisation(id);
    return NextResponse.json({ organisers });
  } catch (error) {
    return handleApiError(error);
  }
}
