import { NextRequest, NextResponse } from 'next/server';
import { getAccountRoles, setAccountRoles } from '@/domain/identity/service';
import { assertPermission, canAssignRoles } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { ForbiddenError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';

// SCRUM-69 AC3 — previously unprotected: any signed-in caller could read or
// change any account's roles. Both handlers now refuse callers whose role
// doesn't carry 'account_role_management' before touching any data.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { roles: callerRoles } = await getCurrentActor();
    assertPermission(callerRoles, 'account_role_management');
    const { id } = await params;
    const roles = await getAccountRoles(id);
    return NextResponse.json({ accountId: id, roles });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId: callerId, roles: callerRoles } = await getCurrentActor();
    assertPermission(callerRoles, 'account_role_management');
    const { id } = await params;
    // US-3.1-TC03 — roles are read-only on your own profile: an operations
    // manager may not strip or escalate their own account, even though the
    // permission matrix above lets them manage roles in general.
    if (!canAssignRoles(callerRoles, id, callerId)) {
      throw new ForbiddenError('You cannot assign roles to your own account.');
    }
    const body = await req.json();
    const roles = await setAccountRoles(id, body.roles);
    return NextResponse.json({ accountId: id, roles });
  } catch (error) {
    return handleApiError(error);
  }
}