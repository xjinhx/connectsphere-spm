import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-160 AC4 through the real API routes: "Given I am an Event Coordinator
 * who is not assigned to the event, when I invoke an equipment-request edit on
 * it, then it is refused and the request is unchanged."
 *
 * TC-160-10 says a hidden button is not a refusal, so the API half matters.
 * These call the real route handlers. Only the session (getCurrentActor) and
 * the service are replaced: the assigned-coordinator rule itself needs the
 * event row, so it is tested against the database in
 * tests/integration/equipment-request.test.ts. What is proved here is the
 * route's half - a role with no equipment_request permission is refused before
 * the body is read or the service is called, a missing session is 401, and the
 * service's refusal of an unassigned coordinator reaches the caller as 403.
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-160 tab (TC-160-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-request/service', () => ({
  addEquipmentLine: vi.fn(),
  updateEquipmentLineQuantity: vi.fn(),
  removeEquipmentLine: vi.fn(),
  getEquipmentRequest: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { addEquipmentLine, removeEquipmentLine, updateEquipmentLineQuantity } from '@/domain/equipment-request/service';
import { ForbiddenError, UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { POST } from '@/app/api/event-requests/[id]/equipment-request/lines/route';
import { DELETE, PATCH } from '@/app/api/event-requests/[id]/equipment-request/lines/[lineId]/route';

const EVENT = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECTOR = '11111111-1111-4111-8111-111111111111';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const url = `http://localhost/api/event-requests/${EVENT}/equipment-request/lines`;
const post = (body: unknown) =>
  POST(new NextRequest(url, { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: EVENT }) });
const lineParams = { params: Promise.resolve({ id: EVENT, lineId: LINE }) };
const patch = (body: unknown) =>
  PATCH(new NextRequest(`${url}/${LINE}`, { method: 'PATCH', body: JSON.stringify(body) }), lineParams);
const remove = () => DELETE(new NextRequest(`${url}/${LINE}`, { method: 'DELETE' }), lineParams);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AC4: the routes refuse an edit before touching the request', () => {
  it('TC-160-10 returns 403 when the service refuses an unassigned coordinator', async () => {
    signInAs('coordinator');
    vi.mocked(addEquipmentLine).mockRejectedValue(new ForbiddenError('This event is not assigned to you.'));

    const response = await post({ equipmentId: PROJECTOR, quantity: 2 });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ message: 'This event is not assigned to you.' });
  });

  it('TC-160-11 returns 403 for a change and a removal the service refuses', async () => {
    signInAs('coordinator');
    vi.mocked(updateEquipmentLineQuantity).mockRejectedValue(new ForbiddenError('This event is not assigned to you.'));
    vi.mocked(removeEquipmentLine).mockRejectedValue(new ForbiddenError('This event is not assigned to you.'));

    expect((await patch({ quantity: 5 })).status).toBe(403);
    expect((await remove()).status).toBe(403);
  });

  it('passes the signed-in account, never one from the body, to the service', async () => {
    signInAs('coordinator');
    vi.mocked(addEquipmentLine).mockResolvedValue({} as never);

    await post({ equipmentId: PROJECTOR, quantity: 2, actorId: 'someone-else' });

    expect(addEquipmentLine).toHaveBeenCalledWith(EVENT, ACCOUNT, expect.anything());
  });

  it.each<Role>(['technical_support', 'venue_staff', 'event_organiser', 'attendee', 'operations_manager'])(
    'refuses %s at the route, before the service is called (403)',
    async (role) => {
      signInAs(role);
      expect((await post({ equipmentId: PROJECTOR, quantity: 2 })).status).toBe(403);
      expect((await patch({ quantity: 5 })).status).toBe(403);
      expect((await remove()).status).toBe(403);
      expect(addEquipmentLine).not.toHaveBeenCalled();
      expect(updateEquipmentLineQuantity).not.toHaveBeenCalled();
      expect(removeEquipmentLine).not.toHaveBeenCalled();
    },
  );

  it('refuses no session at all as unauthenticated (401)', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    expect((await post({ equipmentId: PROJECTOR, quantity: 2 })).status).toBe(401);
    expect((await patch({ quantity: 5 })).status).toBe(401);
    expect((await remove()).status).toBe(401);
  });
});
