import { NextRequest, NextResponse } from 'next/server';
import { getAccountRoles, setAccountRoles } from '@/domain/identity/service';
import { handleApiError } from '@/lib/api/handler';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    const { id } = await params;
    const body = await req.json();
    const roles = await setAccountRoles(id, body.roles);
    return NextResponse.json({ accountId: id, roles });
  } catch (error) {
    return handleApiError(error);
  }
}