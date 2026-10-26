import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-170 through the real route: only Technical Support Staff record units
 * out of service (SCRUM-240 AC3's permission). Only the session and the
 * service are replaced; recording itself is tested against the database in
 * tests/integration/equipment-out-of-service.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-out-of-service/service', () => ({
  recordOutOfService: vi.fn(),
  listOutOfService: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { recordOutOfService } from '@/domain/equipment-out-of-service/service';
import type { Role } from '@/domain/identity/roles';
import { ValidationError } from '@/domain/shared/errors';
import { PUT } from '@/app/api/equipment/[id]/out-of-service/route';

const ITEM = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const record = (body: unknown) =>
  PUT(
    new NextRequest(`http://localhost/api/equipment/${ITEM}/out-of-service`, { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: ITEM }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/equipment/[id]/out-of-service (SCRUM-170)', () => {
  it.each<Role>(['coordinator', 'operations_manager', 'venue_staff', 'event_organiser'])(
    'refuses a %s with 403 before the service is called',
    async (role) => {
      signInAs(role);
      const response = await record({ unavailable: 2, damaged: 0, underMaintenance: 0 });
      expect(response.status).toBe(403);
      expect(recordOutOfService).not.toHaveBeenCalled();
    },
  );

  it('records for Technical Support Staff with 200', async () => {
    signInAs('technical_support');
    vi.mocked(recordOutOfService).mockResolvedValue({
      equipmentId: ITEM,
      quantity: 10,
      counts: { unavailable: 2, damaged: 0, underMaintenance: 0 },
    });

    const response = await record({ unavailable: 2, damaged: 0, underMaintenance: 0 });

    expect(response.status).toBe(200);
    expect(recordOutOfService).toHaveBeenCalledWith(ITEM, { unavailable: 2, damaged: 0, underMaintenance: 0 });
  });

  it('TC-170-06 (AC4): a refusal comes back as 400 with the field named', async () => {
    signInAs('technical_support');
    vi.mocked(recordOutOfService).mockRejectedValue(
      new ValidationError('This item has 10 units, so no more than 10 can be out of service in all.', {
        formErrors: [],
        fieldErrors: { damaged: ['This item has 10 units, so no more than 10 can be out of service in all.'] },
      }),
    );

    const response = await record({ unavailable: 0, damaged: 11, underMaintenance: 0 });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ details: { fieldErrors: { damaged: [expect.any(String)] } } });
  });
});
