import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-240 AC3: "Given I hold any role other than Technical Support Staff,
 * when I try to add or change an equipment item, then it is refused."
 *
 * TC-240-07 says a hidden button is not a refusal, so the API half matters.
 * These call the real route handlers. Only the session (getCurrentActor) and
 * the service behind the route are replaced, so what is proved is the part AC3
 * is about: the route refuses before it parses the body or touches the
 * catalogue, and a missing session is 401 rather than 403.
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-240 tab (TC-240-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment/service', () => ({
  createEquipmentItem: vi.fn(),
  updateEquipmentItem: vi.fn(),
  listEquipment: vi.fn(),
  getEquipmentItem: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { createEquipmentItem, listEquipment, updateEquipmentItem } from '@/domain/equipment/service';
import { UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { POST, GET } from '@/app/api/equipment/route';
import { PATCH } from '@/app/api/equipment/[id]/route';

const EQ_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_ITEM = { name: 'Projector P-200', category: 'av', quantity: 2, currentLocation: 'Bugis store room' };

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}
function noSession() {
  vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
}

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/equipment', { method: 'POST', body: JSON.stringify(body) }));
const patch = (body: unknown) =>
  PATCH(new NextRequest(`http://localhost/api/equipment/${EQ_1}`, { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: EQ_1 }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createEquipmentItem).mockResolvedValue({ id: EQ_1 } as never);
  vi.mocked(updateEquipmentItem).mockResolvedValue({ id: EQ_1 } as never);
  vi.mocked(listEquipment).mockResolvedValue([]);
});

describe('AC3: other roles are refused at the API', () => {
  it('TC-240-07 refuses a Coordinator adding an item, and nothing is saved', async () => {
    signInAs('coordinator');
    const response = await post(NEW_ITEM);
    expect(response.status).toBe(403);
    expect(createEquipmentItem).not.toHaveBeenCalled();
  });

  it.each<Role>(['venue_staff', 'event_organiser', 'attendee', 'operations_manager'])(
    'TC-240-08 refuses %s adding an item and changing a status (403)',
    async (role) => {
      signInAs(role);
      expect((await post(NEW_ITEM)).status).toBe(403);
      expect((await patch({ operationalStatus: 'damaged' })).status).toBe(403);
      expect(createEquipmentItem).not.toHaveBeenCalled();
      expect(updateEquipmentItem).not.toHaveBeenCalled();
    },
  );

  it('TC-240-08 refuses no session at all as unauthenticated (401), for add and change', async () => {
    noSession();
    expect((await post(NEW_ITEM)).status).toBe(401);
    expect((await patch({ operationalStatus: 'damaged' })).status).toBe(401);
    expect(createEquipmentItem).not.toHaveBeenCalled();
    expect(updateEquipmentItem).not.toHaveBeenCalled();
  });

  it('refuses before the body is read: a Coordinator sending junk gets 403, not 400', async () => {
    signInAs('coordinator');
    const response = await POST(new NextRequest('http://localhost/api/equipment', { method: 'POST', body: 'not json' }));
    expect(response.status).toBe(403);
  });
});

describe('AC3: Technical Support Staff are allowed', () => {
  it('lets Technical Support add an item (201) and change one (200)', async () => {
    signInAs('technical_support');
    expect((await post(NEW_ITEM)).status).toBe(201);
    expect((await patch({ operationalStatus: 'damaged' })).status).toBe(200);
    expect(createEquipmentItem).toHaveBeenCalledWith(NEW_ITEM, ACCOUNT);
  });

  it('TC-240-09 lets an account holding coordinator and technical_support add and change', async () => {
    signInAs('coordinator', 'technical_support');
    expect((await post(NEW_ITEM)).status).toBe(201);
    expect((await patch({ operationalStatus: 'damaged' })).status).toBe(200);
  });
});

describe('AC3 and AC5: reading the catalogue is not changing it', () => {
  it('lets a Coordinator list the catalogue, so they can choose from it', async () => {
    signInAs('coordinator');
    expect((await GET()).status).toBe(200);
  });

  it('does not let an Attendee list it', async () => {
    signInAs('attendee');
    expect((await GET()).status).toBe(403);
  });
});
