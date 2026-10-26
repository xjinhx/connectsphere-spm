import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-185 AC5 — PUT /api/event-requests/[id]/registration-settings. Only the
 * role check and the body handling; the service's own refusals are in
 * tests/integration/registration-list.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/registration-list/service', () => ({
  updateRegistrationSettings: vi.fn(),
  getRegistrationSettings: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { updateRegistrationSettings } from '@/domain/registration-list/service';
import { UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { PUT } from '@/app/api/event-requests/[id]/registration-settings/route';

const COORDINATOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EV_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TC_185_01_DATA = { startDate: '2026-11-01', endDate: '2026-11-15', capacity: 250 };

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: COORDINATOR, fullName: 'Test', roles, clientOrganisation: null });
}

const put = (body: string) =>
  PUT(
    new NextRequest(`http://localhost/api/event-requests/${EV_1}/registration-settings`, { method: 'PUT', body }),
    { params: Promise.resolve({ id: EV_1 }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateRegistrationSettings).mockResolvedValue(TC_185_01_DATA);
});

describe('SCRUM-185: PUT /api/event-requests/[id]/registration-settings', () => {
  it('SCRUM-185 AC5 TC-185-01 passes a coordinator through, with the signed-in account as the editor', async () => {
    signInAs('coordinator');
    const response = await put(JSON.stringify(TC_185_01_DATA));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TC_185_01_DATA);
    expect(updateRegistrationSettings).toHaveBeenCalledWith(EV_1, COORDINATOR, TC_185_01_DATA);
  });

  it.each<Role>(['event_organiser', 'operations_manager', 'venue_staff', 'technical_support', 'attendee', 'safety_officer'])(
    'refuses %s with 403, and nothing is saved',
    async (role) => {
      signInAs(role);
      const response = await put(JSON.stringify(TC_185_01_DATA));
      expect(response.status).toBe(403);
      expect(updateRegistrationSettings).not.toHaveBeenCalled();
    },
  );

  it('refuses no session with 401, and nothing is saved', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    const response = await put(JSON.stringify(TC_185_01_DATA));
    expect(response.status).toBe(401);
    expect(updateRegistrationSettings).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON with 400', async () => {
    signInAs('coordinator');
    const response = await put('{');
    expect(response.status).toBe(400);
    expect(updateRegistrationSettings).not.toHaveBeenCalled();
  });
});
