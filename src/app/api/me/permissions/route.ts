import { NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { getPermittedActions } from '@/domain/identity/permissions';
import { handleApiError } from '@/lib/api/handler';

/** SCRUM-69 AC1/AC2 — the signed-in caller's own permitted actions. */
export async function GET() {
  try {
    const { roles } = await getCurrentActor();
    return NextResponse.json({ actions: getPermittedActions(roles) });
  } catch (error) {
    return handleApiError(error);
  }
}
