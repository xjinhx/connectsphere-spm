import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-181 Register for an event: the API route. These call the real route
 * handler; only the session (getCurrentActor) and the service behind the route
 * are replaced, so what is proved is that only attendees reach the service,
 * that the attendee is the signed-in account, and that each refusal reaches
 * the browser with the right status and message. The refusals themselves run
 * against the database in tests/integration/register-for-event.test.ts.
 *
 * Test case IDs are from SCRUM-181-test-cases.xlsx (TC-181-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-registration/service', () => ({
  registerForEvent: vi.fn(),
  getRegistrationPage: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { registerForEvent } from '@/domain/event-registration/service';
import { ALREADY_REGISTERED } from '@/domain/event-registration/policy';
import { ConflictError, UnauthenticatedError, ValidationError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { POST } from '@/app/api/events/[id]/registrations/route';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const ACCOUNT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID = { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' };
const REGISTRATION = { reference: 'REG-2026-0001', status: 'registered' };

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({ userId: ACCOUNT, fullName: 'Test', roles, clientOrganisation: null });
}

const post = (body: unknown) =>
  POST(
    new NextRequest(`http://localhost/api/events/${EVENT_ID}/registrations`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: EVENT_ID }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(registerForEvent).mockResolvedValue(REGISTRATION as never);
});

describe('only attendees register', () => {
  it('TC-181-01 passes an attendee through, as the signed-in account, and answers 201 with the registration', async () => {
    signInAs('attendee');
    const response = await post(VALID);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(REGISTRATION);
    expect(registerForEvent).toHaveBeenCalledWith(EVENT_ID, ACCOUNT, VALID);
  });

  it('ignores an attendee id in the body: the signed-in account registers', async () => {
    signInAs('attendee');
    await post({ ...VALID, attendeeId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(vi.mocked(registerForEvent).mock.calls[0]?.[1]).toBe(ACCOUNT);
  });

  it.each<Role>(['event_organiser', 'coordinator', 'operations_manager', 'venue_staff', 'technical_support', 'safety_officer'])(
    'refuses %s with 403 before anything is read',
    async (role) => {
      signInAs(role);
      const response = await post(VALID);
      expect(response.status).toBe(403);
      expect(registerForEvent).not.toHaveBeenCalled();
    },
  );

  it('refuses no session with 401', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    expect((await post(VALID)).status).toBe(401);
    expect(registerForEvent).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON with 400', async () => {
    signInAs('attendee');
    expect((await post('not json')).status).toBe(400);
    expect(registerForEvent).not.toHaveBeenCalled();
  });
});

describe('refusals reach the browser', () => {
  it('TC-181-06 before the start date: 400 with the start date in the message', async () => {
    signInAs('attendee');
    vi.mocked(registerForEvent).mockRejectedValue(new ValidationError('Registration opens on 01/11/2026.'));

    const response = await post(VALID);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'VALIDATION_ERROR', message: 'Registration opens on 01/11/2026.' });
  });

  it('TC-181-09 after the end date: 400 with the end date in the message', async () => {
    signInAs('attendee');
    vi.mocked(registerForEvent).mockRejectedValue(new ValidationError('Registration closed on 28/10/2026.'));

    const response = await post(VALID);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'Registration closed on 28/10/2026.' });
  });

  it('TC-181-14 already registered: 409 with the existing registration', async () => {
    signInAs('attendee');
    vi.mocked(registerForEvent).mockRejectedValue(new ConflictError(ALREADY_REGISTERED, { registration: REGISTRATION }));

    const response = await post(VALID);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: ALREADY_REGISTERED,
      details: { registration: { reference: 'REG-2026-0001' } },
    });
  });
});
