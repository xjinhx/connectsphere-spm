import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-100 AC1: only the event's assigned coordinator may store its essential
 * set. TC-100-03 says a hidden control is not a refusal, so the API half
 * matters. These call the real route handler; only the session
 * (getCurrentActor) and the service behind the route are replaced, so what is
 * proved is that the route refuses every other role before touching the event.
 *
 * A coordinator the event is not assigned to passes the route and is refused
 * by the service; that half runs against the database in
 * tests/integration/essential-arrangements.test.ts.
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/essential-arrangements/service', () => ({
  recordEssentialArrangements: vi.fn(),
  getEssentialArrangements: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { recordEssentialArrangements } from '@/domain/essential-arrangements/service';
import { UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { PUT } from '@/app/api/event-requests/[id]/essential-arrangements/route';

const EV_1 = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AC1_SET = { venue: 'essential', equipment: 'not_required', technicalSupport: 'not_required', registration: 'not_required' };

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const put = (body: unknown) =>
  PUT(
    new NextRequest(`http://localhost/api/event-requests/${EV_1}/essential-arrangements`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: EV_1 }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(recordEssentialArrangements).mockResolvedValue(AC1_SET as never);
});

describe('AC1: only coordinators reach the service', () => {
  it('passes a coordinator through, with the signed-in account as the recorder', async () => {
    signInAs('coordinator');
    const response = await put(AC1_SET);
    expect(response.status).toBe(200);
    expect(recordEssentialArrangements).toHaveBeenCalledWith(EV_1, ACCOUNT, AC1_SET);
  });

  it.each<Role>(['event_organiser', 'venue_staff', 'technical_support', 'operations_manager', 'attendee'])(
    'TC-100-03 refuses %s with 403, and nothing is stored',
    async (role) => {
      signInAs(role);
      const response = await put(AC1_SET);
      expect(response.status).toBe(403);
      expect(recordEssentialArrangements).not.toHaveBeenCalled();
    },
  );

  it('TC-100-03 refuses no session with 401, and nothing is stored', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    const response = await put(AC1_SET);
    expect(response.status).toBe(401);
    expect(recordEssentialArrangements).not.toHaveBeenCalled();
  });
});
