import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-185 AC2-AC4 — GET /api/event-requests/[id]/registration-list/export.
 * Only the role check and the response; who among organisers may export is
 * the service's (tests/integration/registration-list-view.test.ts).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/registration-list/service', () => ({
  exportRegistrationList: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { exportRegistrationList } from '@/domain/registration-list/service';
import { EXPORT_NOT_ALLOWED_MESSAGE } from '@/domain/registration-list/policy';
import { ForbiddenError, UnauthenticatedError } from '@/domain/shared/errors';
import type { Role } from '@/domain/identity/roles';
import { GET } from '@/app/api/event-requests/[id]/registration-list/export/route';

const ORGANISER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EV_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CSV = 'Reference,Full name,Email,Contact number,Registration date,Status\r\n';

function signInAs(...roles: Role[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: ORGANISER,
    fullName: 'Test',
    roles,
    clientOrganisation: { id: '22222222-2222-2222-2222-222222222222', name: 'Harbour Events' },
  });
}

const get = () =>
  GET(new Request(`http://localhost/api/event-requests/${EV_1}/registration-list/export`), {
    params: Promise.resolve({ id: EV_1 }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exportRegistrationList).mockResolvedValue({ fileName: 'registrations-EVT-2026-0001.csv', csv: CSV });
});

describe('SCRUM-185: GET /api/event-requests/[id]/registration-list/export', () => {
  it('SCRUM-185 AC2 TC-185-10 an organiser gets the CSV as a download', async () => {
    signInAs('event_organiser');
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="registrations-EVT-2026-0001.csv"');
    expect(await response.text()).toBe(CSV);
    expect(exportRegistrationList).toHaveBeenCalledWith(EV_1, expect.objectContaining({ userId: ORGANISER }));
  });

  it('SCRUM-185 AC3 TC-185-12 an organiser the service refuses gets 403 and no file', async () => {
    signInAs('event_organiser');
    vi.mocked(exportRegistrationList).mockRejectedValue(new ForbiddenError(EXPORT_NOT_ALLOWED_MESSAGE));
    const response = await get();
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe(EXPORT_NOT_ALLOWED_MESSAGE);
  });

  it.each<Role>(['coordinator', 'operations_manager', 'venue_staff', 'technical_support', 'attendee', 'safety_officer'])(
    'refuses %s with 403 before reading anything',
    async (role) => {
      signInAs(role);
      const response = await get();
      expect(response.status).toBe(403);
      expect(exportRegistrationList).not.toHaveBeenCalled();
    },
  );

  it('refuses no session with 401', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    const response = await get();
    expect(response.status).toBe(401);
    expect(exportRegistrationList).not.toHaveBeenCalled();
  });
});
