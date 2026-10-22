import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-249 AC5 through the real route: POST /api/me/working-as and DELETE.
 * Only the session (getCurrentActor) is replaced. Test case IDs match the
 * SCRUM-249 tab of the Sprint 4 sheet.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { WORKING_AS_COOKIE } from '@/domain/navigation/policy';
import { DELETE, POST } from '@/app/api/me/working-as/route';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/me/working-as', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SCRUM-249 AC5: POST /api/me/working-as', () => {
  it('TC-249-18: switches to a held role, saves it and answers with its landing page', async () => {
    signInAs('coordinator', 'venue_staff');

    const response = await post({ role: 'coordinator' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: 'coordinator', landingPath: '/assigned-events' });
    expect(response.cookies.get(WORKING_AS_COOKIE)?.value).toBe('coordinator');
  });

  it('TC-249-24: refuses a role the account does not hold, and saves nothing', async () => {
    signInAs('coordinator', 'venue_staff');

    const response = await post({ role: 'technical_support' });

    expect(response.status).toBe(403);
    expect(response.cookies.get(WORKING_AS_COOKIE)).toBeUndefined();
  });

  it('refuses a value that is not a role', async () => {
    signInAs('coordinator', 'venue_staff');

    for (const body of [{ role: 'admin' }, {}, null]) {
      const response = await post(body);
      expect(response.status).toBe(400);
    }
  });

  it('refuses a caller who is not signed in', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());

    const response = await post({ role: 'coordinator' });

    expect(response.status).toBe(401);
  });
});

describe('SCRUM-249 AC5: DELETE /api/me/working-as', () => {
  it('TC-249-21: clears the choice, so the next login starts on the default role', async () => {
    const response = await DELETE();

    expect(response.status).toBe(204);
    const cleared = response.cookies.get(WORKING_AS_COOKIE);
    expect(cleared?.value).toBe('');
  });
});
