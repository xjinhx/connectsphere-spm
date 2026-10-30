import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-184 Withdraw my registration: the API route. These call the real
 * route handler; only the session (getCurrentActor) and the service behind it
 * are replaced, so what is proved is that only attendees reach the service,
 * that the attendee is the signed-in account, and that each refusal reaches
 * the browser with the right status and message.
 *
 * Test case IDs are from SCRUM-184-test-cases.xlsx (TC-184-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-registration/service', () => ({ withdrawRegistration: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { withdrawRegistration } from '@/domain/event-registration/service';
import { ALREADY_WITHDRAWN, EVENT_TAKEN_PLACE } from '@/domain/event-registration/policy';
import { DomainError, NotFoundError, UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { POST } from '@/app/api/events/[id]/registrations/[registrationId]/withdraw/route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const REGISTRATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WITHDRAWN = { id: REGISTRATION_ID, reference: 'REG-2026-0001', status: 'withdrawn' };

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const post = () =>
  POST(
    new NextRequest(`http://localhost/api/events/${EVENT_ID}/registrations/${REGISTRATION_ID}/withdraw`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ id: EVENT_ID, registrationId: REGISTRATION_ID }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(withdrawRegistration).mockResolvedValue(WITHDRAWN as never);
});

describe('SCRUM-184 AC1: only the attendee withdraws their own registration', () => {
  it('TC-184-01 passes an attendee through, as the signed-in account, and answers 200 with the registration Withdrawn', async () => {
    signInAs('attendee');
    const response = await post();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(WITHDRAWN);
    expect(withdrawRegistration).toHaveBeenCalledWith(EVENT_ID, REGISTRATION_ID, ACCOUNT);
  });

  it('TC-184-03 already withdrawn: 409 INVALID_TRANSITION with the message', async () => {
    signInAs('attendee');
    vi.mocked(withdrawRegistration).mockRejectedValue(new DomainError('INVALID_TRANSITION', ALREADY_WITHDRAWN));

    const response = await post();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'INVALID_TRANSITION', message: ALREADY_WITHDRAWN });
  });

  it("TC-184-04 someone else's registration: 404 NOT_FOUND", async () => {
    signInAs('attendee');
    vi.mocked(withdrawRegistration).mockRejectedValue(new NotFoundError('Registration'));

    const response = await post();

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'NOT_FOUND' });
  });

  it('TC-184-04 no session: 401, and the service is not reached', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    expect((await post()).status).toBe(401);
    expect(withdrawRegistration).not.toHaveBeenCalled();
  });

  it.each<Role>(['event_organiser', 'coordinator', 'operations_manager', 'venue_staff', 'technical_support', 'safety_officer'])(
    'refuses %s with 403 before anything is read',
    async (role) => {
      signInAs(role);
      expect((await post()).status).toBe(403);
      expect(withdrawRegistration).not.toHaveBeenCalled();
    },
  );
});

describe('SCRUM-184 AC3: the server refuses once the event has taken place', () => {
  it('TC-184-07 409 INVALID_TRANSITION with the message, so hiding the button is not the only guard', async () => {
    signInAs('attendee');
    vi.mocked(withdrawRegistration).mockRejectedValue(new DomainError('INVALID_TRANSITION', EVENT_TAKEN_PLACE));

    const response = await post();

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'INVALID_TRANSITION', message: EVENT_TAKEN_PLACE });
  });
});
