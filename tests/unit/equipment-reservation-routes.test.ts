import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-173 through the real reserve route: only Technical Support Staff
 * reserve equipment. Only the session and the service are replaced; reserving
 * itself is tested against the database in
 * tests/integration/equipment-reservation.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-reservation/service', () => ({
  reserveEquipment: vi.fn(),
  checkEquipmentAvailability: vi.fn(),
  listEventReservations: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { reserveEquipment } from '@/domain/equipment-reservation/service';
import type { Role } from '@/domain/identity/roles';
import { UnavailableError } from '@/domain/shared/errors';
import { POST } from '@/app/api/event-requests/[id]/equipment-request/lines/[lineId]/reservation/route';

const EVENT = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const reserve = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/event-requests/${EVENT}/equipment-request/lines/${LINE}/reservation`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: EVENT, lineId: LINE }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST .../lines/[lineId]/reservation (SCRUM-173)', () => {
  it.each<Role>(['coordinator', 'operations_manager', 'venue_staff', 'event_organiser'])(
    'refuses a %s with 403 before the service is called',
    async (role) => {
      signInAs(role);
      const response = await reserve({ quantity: 2 });
      expect(response.status).toBe(403);
      expect(reserveEquipment).not.toHaveBeenCalled();
    },
  );

  it('reserves for Technical Support Staff with 201, passing the signed-in account', async () => {
    signInAs('technical_support');
    vi.mocked(reserveEquipment).mockResolvedValue({
      id: '55555555-5555-4555-8555-555555555555',
      lineId: LINE,
      equipmentId: '11111111-1111-4111-8111-111111111111',
      equipmentName: 'Projector',
      quantity: 2,
      window: { start: '2026-11-09', end: '2026-11-12' },
      status: 'reserved',
      reservedAt: '2026-10-20T00:00:00Z',
    });

    const response = await reserve({ quantity: 2 });

    expect(response.status).toBe(201);
    expect(reserveEquipment).toHaveBeenCalledWith(EVENT, LINE, ACCOUNT, { quantity: 2 });
  });

  it('TC-173-04 (AC4): an item with nothing free comes back as 409 with how many are available', async () => {
    signInAs('technical_support');
    vi.mocked(reserveEquipment).mockRejectedValue(
      new UnavailableError("This item is unavailable for the event's window.", { available: 0 }),
    );

    const response = await reserve({ quantity: 1 });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ details: { available: 0 } });
  });

  it('TC-175-01 (SCRUM-175 AC1): the 409 carries how many are available and the partial offer', async () => {
    signInAs('technical_support');
    vi.mocked(reserveEquipment).mockRejectedValue(
      new UnavailableError("Only 5 available for the event's window.", {
        available: 5,
        offer: { quantity: 5, shortfall: 1 },
      }),
    );

    const response = await reserve({ quantity: 6 });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: "Only 5 available for the event's window.",
      details: { available: 5, offer: { quantity: 5, shortfall: 1 } },
    });
  });
});
