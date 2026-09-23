import { NextRequest, NextResponse } from 'next/server';
import { getAccountOrganisation, setAccountOrganisation } from '@/domain/identity/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * SCRUM-204 AC1 — read or assign the client organisation an Event Organiser
 * account belongs to. Mirrors /api/accounts/[id]/roles: only a caller
 * permitted for organisation_membership_management (Event Coordinator, see
 * identity/permissions.ts) may call this.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { roles: callerRoles } = await getCurrentActor();
    assertPermission(callerRoles, 'organisation_membership_management');
    const { id } = await params;
    const membership = await getAccountOrganisation(id);
    return NextResponse.json(membership);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { roles: callerRoles } = await getCurrentActor();
    assertPermission(callerRoles, 'organisation_membership_management');
    const { id } = await params;
    const body = await req.json();
    const membership = await setAccountOrganisation(id, body);
    return NextResponse.json(membership);
  } catch (error) {
    return handleApiError(error);
  }
}
