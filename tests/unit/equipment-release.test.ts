import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-177 Release a reservation, through the real release route: only
 * Technical Support Staff release, with a reason. Only the session and the
 * service are replaced; releasing itself is tested against the database in
 * tests/integration/equipment-release.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-reservation/service', () => ({ releaseEquipmentReservation: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { releaseEquipmentReservation } from '@/domain/equipment-reservation/service';
import {
  RELEASE_RESERVATION_REASON_REQUIRED,
  ReleaseReservationInputSchema,
} from '@/domain/equipment-reservation/schema';
import type { Role } from '@/domain/identity/roles';
import { ConflictError } from '@/domain/shared/errors';
import { POST } from '@/app/api/event-requests/[id]/equipment-reservations/[reservationId]/release/route';

const EVENT = '33333333-3333-4333-8333-333333333333';
const RESERVATION = '55555555-5555-4555-8555-555555555555';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const release = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/event-requests/${EVENT}/equipment-reservations/${RESERVATION}/release`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: EVENT, reservationId: RESERVATION }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST .../equipment-reservations/[reservationId]/release (SCRUM-177)', () => {
  it('TC-177-01 (AC1): Technical Support Staff release with a reason; 200 with the reservation Released, its reason and date', async () => {
    signInAs('technical_support');
    vi.mocked(releaseEquipmentReservation).mockResolvedValue({
      id: RESERVATION,
      lineId: '44444444-4444-4444-8444-444444444444',
      equipmentId: '11111111-1111-4111-8111-111111111111',
      equipmentName: 'EQ-177-01',
      quantity: 4,
      window: { start: '2026-11-09', end: '2026-11-10' },
      status: 'released',
      reservedAt: '2026-10-27T00:00:00Z',
      reviewRequired: false,
      reviewRequiredAt: null,
      reviewRequiredCause: null,
      releaseReason: 'Client no longer needs projectors',
      releasedAt: '2026-10-27T02:00:00Z',
    });

    const response = await release({ reason: 'Client no longer needs projectors' });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      reservation: { status: 'released', releaseReason: 'Client no longer needs projectors', releasedAt: '2026-10-27T02:00:00Z' },
    });
    expect(releaseEquipmentReservation).toHaveBeenCalledWith(EVENT, RESERVATION, ACCOUNT, {
      reason: 'Client no longer needs projectors',
    });
  });

  it('TC-177-06 (AC1): a reservation already Released is refused with 409', async () => {
    signInAs('technical_support');
    vi.mocked(releaseEquipmentReservation).mockRejectedValue(
      new ConflictError('This reservation has already been released.'),
    );

    const response = await release({ reason: 'Second try' });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: 'This reservation has already been released.' });
  });

  it.each<Role>(['coordinator', 'operations_manager', 'venue_staff', 'event_organiser'])(
    'TC-177-07 (AC1): refuses a %s with 403 before the service is called',
    async (role) => {
      signInAs(role);
      const response = await release({ reason: 'Client no longer needs projectors' });
      expect(response.status).toBe(403);
      expect(releaseEquipmentReservation).not.toHaveBeenCalled();
    },
  );
});

describe('ReleaseReservationInputSchema (SCRUM-177 AC1)', () => {
  it.each([
    ['TC-177-03', 'an empty reason', { reason: '' }],
    ['TC-177-03', 'no reason sent', {}],
    ['TC-177-04', 'a reason of only spaces', { reason: '   ' }],
  ])('%s: refuses %s, naming the reason', (_id, _label, input) => {
    const result = ReleaseReservationInputSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors).toEqual({ reason: [RELEASE_RESERVATION_REASON_REQUIRED] });
  });

  it('keeps the reason as typed, trimmed', () => {
    expect(ReleaseReservationInputSchema.parse({ reason: '  Event scaled down ' })).toEqual({
      reason: 'Event scaled down',
    });
  });
});
