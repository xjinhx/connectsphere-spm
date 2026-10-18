import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-164 through the real API route. Only the session (getCurrentActor) and
 * the service are replaced; the queue itself is read from the database in
 * tests/integration/equipment-queue.test.ts.
 *
 * What is proved here is the route's half: only Technical Support Staff get the
 * queue (TC-164-03 - every other role is refused with 403 before anything is
 * read), and a missing session is 401.
 *
 * Test case IDs are from the SCRUM-164 tab (TC-164-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-request/service', () => ({ listEquipmentQueue: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { listEquipmentQueue } from '@/domain/equipment-request/service';
import { UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { GET } from '@/app/api/equipment-queue/route';

const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const get = () => GET();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SCRUM-164: who may open the queue', () => {
  it('returns the queue to Technical Support Staff', async () => {
    signInAs('technical_support');
    vi.mocked(listEquipmentQueue).mockResolvedValue([]);

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it.each<Role>(['coordinator', 'operations_manager', 'venue_staff', 'event_organiser', 'attendee'])(
    'TC-164-03 refuses %s with 403 and reads nothing',
    async (role) => {
      signInAs(role);

      const response = await get();

      expect(response.status).toBe(403);
      expect(listEquipmentQueue).not.toHaveBeenCalled();
    },
  );

  it('refuses no session at all as unauthenticated (401)', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    expect((await get()).status).toBe(401);
    expect(listEquipmentQueue).not.toHaveBeenCalled();
  });
});
