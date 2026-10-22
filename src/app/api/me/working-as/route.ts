import { NextRequest, NextResponse } from 'next/server';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';
import { ValidationError } from '@/domain/shared/errors';
import { WorkingAsInputSchema } from '@/domain/navigation/schema';
import { assertCanWorkAs, landingPathFor, WORKING_AS_COOKIE } from '@/domain/navigation/policy';

/**
 * SCRUM-249 AC5 — "Working as".
 *
 * POST { role } switches the role the header and landing page are shown for,
 * and answers with that role's landing page to open. Refused (403) for a role
 * the account does not hold. Switching changes only the landing page and nav:
 * every other route still checks the account's full set of roles.
 *
 * DELETE clears the choice. The login page and Log out call it, so every login
 * starts on the default role (PO, 22 Oct 2026).
 */
export async function POST(request: NextRequest) {
  try {
    const { roles } = await getCurrentActor();
    const parsed = WorkingAsInputSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError('Choose one of your roles.', parsed.error.flatten());
    }
    assertCanWorkAs(roles, parsed.data.role);

    const response = NextResponse.json({
      role: parsed.data.role,
      landingPath: landingPathFor(parsed.data.role),
    });
    response.cookies.set(WORKING_AS_COOKIE, parsed.data.role, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  const response = new NextResponse(null, { status: 204 });
  response.cookies.delete(WORKING_AS_COOKIE);
  return response;
}
