import { NextRequest, NextResponse } from 'next/server';
import { getAccountRoles, getCallerRoles, setAccountRoles } from '@/domain/identity/service';
import { assertPermission } from '@/domain/identity/policy';
import { handleApiError } from '@/lib/api/handler';

// SCRUM-69 AC3 — previously unprotected: any signed-in caller could read or
// change any account's roles. Both handlers now refuse callers whose role
// doesn't carry 'account_role_management' before touching any data.

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const callerRoles = await getCallerRoles();
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
    const callerRoles = await getCallerRoles();
    assertPermission(callerRoles, 'account_role_management');
    const { id } = await params;
    const body = await req.json();
    const roles = await setAccountRoles(id, body.roles);
    return NextResponse.json({ accountId: id, roles });
  } catch (error) {
    return handleApiError(error);
  }
}