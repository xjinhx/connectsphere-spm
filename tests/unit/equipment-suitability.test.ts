import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * SCRUM-171 Assess whether requested equipment is suitable for the event: the
 * rules, and the routes' half of who may review. No database - what is saved
 * and read back, and SCRUM-167's real availability check, are in
 * tests/integration/equipment-suitability.test.ts.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given an equipment requirement recorded against an event, when I
 *        review it, then I can mark each requested item suitable or not
 *        suitable and record why."
 *   AC2 "Given I mark an item not suitable, when I save the review, then it
 *        appears on the request as an unmet requirement with my reason."
 *   AC3 moved to SCRUM-176 (CL-50): no test here.
 *   AC4 "Given every requested item is marked suitable and is available for
 *        the commitment window, when I complete the review, then the request
 *        is marked ready to reserve."
 *
 * Test case IDs are from the SCRUM-171 tab of the Sprint 4 sheet (TC-171-nn).
 */

vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/equipment-request/service', () => ({
  saveEquipmentSuitability: vi.fn(),
  completeEquipmentReview: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { completeEquipmentReview, saveEquipmentSuitability } from '@/domain/equipment-request/service';
import {
  NOT_SUITABLE_REASON_MESSAGE,
  UNKNOWN_SUITABILITY_LINE_MESSAGE,
  notReadyReasons,
  suitabilityProblem,
  suitabilityToStore,
  unmetRequirements,
  type ReviewedLine,
} from '@/domain/equipment-request/policy';
import { SaveSuitabilityInputSchema, CHOOSE_SUITABILITY_MESSAGE } from '@/domain/equipment-request/schema';
import type { Role } from '@/domain/identity/roles';
import { UnauthenticatedError } from '@/domain/shared/errors';
import { PUT } from '@/app/api/event-requests/[id]/equipment-request/suitability/route';
import { POST } from '@/app/api/event-requests/[id]/equipment-request/review/route';

const EVENT = '33333333-3333-4333-8333-333333333333';
const PROJECTOR = '44444444-4444-4444-8444-444444444444';
const MIC = '55555555-5555-4555-8555-555555555555';
const LECTERN = '66666666-6666-4666-8666-666666666666';
const LINES = [PROJECTOR, MIC, LECTERN];
const NO_WINDOW = 'The event has no approved venue booking.';

const parse = (input: unknown) => SaveSuitabilityInputSchema.safeParse(input);
const verdicts = (input: unknown) => {
  const result = parse(input);
  if (!result.success) throw new Error(result.error.issues[0]?.message);
  return result.data.verdicts;
};

/** EVT-A's three items, each with a verdict. */
const reviewed = (projector: ReviewedLine['suitability'], mic: ReviewedLine['suitability'], lectern: ReviewedLine['suitability']) => [
  { lineId: PROJECTOR, equipmentName: 'Projector P-100', suitability: projector },
  { lineId: MIC, equipmentName: 'Wireless Mic WM-3', suitability: mic },
  { lineId: LECTERN, equipmentName: 'Lectern LC-1', suitability: lectern },
];
/** SCRUM-167's check: each item's shortfall for the window (0 = available). */
const checked = (projector: number, mic: number, lectern: number) => [
  { lineId: PROJECTOR, shortfall: projector },
  { lineId: MIC, shortfall: mic },
  { lineId: LECTERN, shortfall: lectern },
];

describe('SCRUM-171 AC1: mark each item suitable or not suitable and record why', () => {
  it('TC-171-01 accepts a suitable and a not suitable item, each with its reason', () => {
    const saved = verdicts({
      verdicts: [
        { lineId: PROJECTOR, suitability: 'suitable', reason: 'Bright enough for the seminar room' },
        { lineId: MIC, suitability: 'not_suitable', reason: 'Panel needs lapel mics' },
      ],
    });
    expect(suitabilityProblem(saved, LINES)).toBeNull();
    expect(saved.map(suitabilityToStore)).toEqual([
      { lineId: PROJECTOR, suitability: 'suitable', reason: 'Bright enough for the seminar room' },
      { lineId: MIC, suitability: 'not_suitable', reason: 'Panel needs lapel mics' },
    ]);
  });

  it('TC-171-02 refuses not suitable with no reason, naming the item', () => {
    const saved = verdicts({ verdicts: [{ lineId: MIC, suitability: 'not_suitable', reason: '' }] });
    expect(suitabilityProblem(saved, LINES)).toEqual({ field: 'reason', message: NOT_SUITABLE_REASON_MESSAGE, lineIds: [MIC] });
    const missing = verdicts({ verdicts: [{ lineId: MIC, suitability: 'not_suitable' }] });
    expect(suitabilityProblem(missing, LINES)?.field).toBe('reason');
  });

  it('TC-171-02 refuses the whole review when one item is missing its reason', () => {
    const saved = verdicts({
      verdicts: [
        { lineId: PROJECTOR, suitability: 'suitable', reason: 'Fine' },
        { lineId: MIC, suitability: 'not_suitable', reason: '' },
      ],
    });
    expect(suitabilityProblem(saved, LINES)?.lineIds).toEqual([MIC]);
  });

  it('TC-171-03 accepts suitable with no reason (boundary: a reason is only required for not suitable)', () => {
    const saved = verdicts({ verdicts: [{ lineId: PROJECTOR, suitability: 'suitable', reason: '' }] });
    expect(suitabilityProblem(saved, LINES)).toBeNull();
    expect(suitabilityToStore(saved[0]!)).toEqual({ lineId: PROJECTOR, suitability: 'suitable', reason: null });
  });

  it.each([' ', '   ', ' \n\t '])('TC-171-04 treats %j as no reason, and refuses it for not suitable (boundary: whitespace)', (reason) => {
    const saved = verdicts({ verdicts: [{ lineId: MIC, suitability: 'not_suitable', reason }] });
    expect(saved[0]?.reason).toBeNull();
    expect(suitabilityProblem(saved, LINES)?.message).toBe(NOT_SUITABLE_REASON_MESSAGE);
  });

  it('keeps the reason trimmed', () => {
    expect(verdicts({ verdicts: [{ lineId: MIC, suitability: 'not_suitable', reason: '  Panel needs lapel mics ' }] })[0]?.reason).toBe(
      'Panel needs lapel mics',
    );
  });

  it.each(['fine', 'SUITABLE', '', 1])('refuses %j as a verdict', (suitability) => {
    const result = parse({ verdicts: [{ lineId: MIC, suitability, reason: 'x' }] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(CHOOSE_SUITABILITY_MESSAGE);
  });

  it('allows an item to be left unmarked, and keeps no reason for it', () => {
    const saved = verdicts({ verdicts: [{ lineId: LECTERN, suitability: null, reason: 'left over' }] });
    expect(suitabilityProblem(saved, LINES)).toBeNull();
    expect(suitabilityToStore(saved[0]!)).toEqual({ lineId: LECTERN, suitability: null, reason: null });
  });

  it('refuses a reason over 500 characters (boundary: 500 accepted)', () => {
    expect(parse({ verdicts: [{ lineId: MIC, suitability: 'not_suitable', reason: 'x'.repeat(500) }] }).success).toBe(true);
    expect(parse({ verdicts: [{ lineId: MIC, suitability: 'not_suitable', reason: 'x'.repeat(501) }] }).success).toBe(false);
  });

  it('refuses an empty review, and the same item twice', () => {
    expect(parse({ verdicts: [] }).success).toBe(false);
    expect(
      parse({
        verdicts: [
          { lineId: MIC, suitability: 'suitable' },
          { lineId: MIC, suitability: 'not_suitable', reason: 'x' },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses an item that is not on the request', () => {
    const other = '77777777-7777-4777-8777-777777777777';
    const saved = verdicts({ verdicts: [{ lineId: other, suitability: 'suitable' }] });
    expect(suitabilityProblem(saved, LINES)).toEqual({ field: 'verdicts', message: UNKNOWN_SUITABILITY_LINE_MESSAGE, lineIds: [other] });
  });
});

describe('SCRUM-171 AC2: an item not suitable appears as an unmet requirement with the reason', () => {
  const line = (id: string, suitability: 'suitable' | 'not_suitable' | null, reason: string | null) => ({
    id,
    suitability,
    suitabilityReason: reason,
  });

  it('TC-171-06 lists the item not suitable, with its reason', () => {
    const lines = [
      line(PROJECTOR, 'suitable', 'Bright enough for the seminar room'),
      line(MIC, 'not_suitable', 'Panel needs lapel mics'),
      line(LECTERN, null, null),
    ];
    expect(unmetRequirements(lines)).toEqual([line(MIC, 'not_suitable', 'Panel needs lapel mics')]);
  });

  it('TC-171-08 marking it suitable again takes it off', () => {
    expect(unmetRequirements([line(MIC, 'suitable', 'Lapel mics found')])).toEqual([]);
  });

  it('TC-171-07 an item not suitable is still counted as available: readiness reads its verdict, not a smaller quantity', () => {
    // Not suitable never reaches SCRUM-167's figure: the item is still 0 short.
    expect(notReadyReasons(reviewed('suitable', 'not_suitable', 'suitable'), checked(0, 0, 0), NO_WINDOW)).toEqual([
      { kind: 'not_suitable', message: 'Wireless Mic WM-3 is not suitable.' },
    ]);
  });
});

describe('SCRUM-171 AC4: ready to reserve when every item is suitable and available for the window', () => {
  it('TC-171-10 every item suitable and none short: ready', () => {
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), checked(0, 0, 0), NO_WINDOW)).toEqual([]);
  });

  it('TC-171-11 one item not suitable: not ready', () => {
    expect(notReadyReasons(reviewed('suitable', 'not_suitable', 'suitable'), checked(0, 0, 0), NO_WINDOW)).toEqual([
      { kind: 'not_suitable', message: 'Wireless Mic WM-3 is not suitable.' },
    ]);
  });

  it('TC-171-12 every item suitable but one short for the window: not ready, naming it', () => {
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), checked(0, 0, 1), NO_WINDOW)).toEqual([
      { kind: 'short', message: 'Lectern LC-1 is short by 1 for the commitment window.' },
    ]);
  });

  it('TC-171-13 a shortfall of 0 is ready, and of 1 is not (boundary)', () => {
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), checked(0, 0, 0), NO_WINDOW)).toEqual([]);
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), checked(0, 1, 0), NO_WINDOW)).toEqual([
      { kind: 'short', message: 'Wireless Mic WM-3 is short by 1 for the commitment window.' },
    ]);
  });

  it('TC-171-14 an unmarked item: not ready', () => {
    expect(notReadyReasons(reviewed('suitable', 'suitable', null), checked(0, 0, 0), NO_WINDOW)).toEqual([
      { kind: 'unmarked', message: 'Lectern LC-1 has not been marked.' },
    ]);
  });

  it('TC-171-17 reads what SCRUM-167 found short, whatever the reason (units out of service included)', () => {
    // The shortfall comes from checkEquipmentAvailability, which already takes
    // units out of service and other events' reservations off.
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), checked(0, 1, 0), NO_WINDOW)[0]?.kind).toBe('short');
  });

  it('lists every reason it is not ready, not just the first', () => {
    expect(notReadyReasons(reviewed(null, 'not_suitable', 'suitable'), checked(0, 0, 2), NO_WINDOW).map((r) => r.kind)).toEqual([
      'unmarked',
      'not_suitable',
      'short',
    ]);
  });

  it('no commitment window (no approved venue booking): not ready, saying why', () => {
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), null, NO_WINDOW)).toEqual([
      { kind: 'no_window', message: NO_WINDOW },
    ]);
  });

  it('an item the check did not cover: not ready', () => {
    expect(notReadyReasons(reviewed('suitable', 'suitable', 'suitable'), checked(0, 0, 0).slice(0, 2), NO_WINDOW)[0]?.kind).toBe(
      'short',
    );
  });

  it('a request with no items: not ready', () => {
    expect(notReadyReasons([], [], NO_WINDOW)).toEqual([{ kind: 'no_items', message: 'No equipment has been requested.' }]);
  });
});

describe('SCRUM-171: only Technical Support Staff review (the routes)', () => {
  const asRole = (roles: Role[]) =>
    vi.mocked(getCurrentActor).mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      fullName: 'Test',
      roles,
      clientOrganisation: null,
    });
  const ctx = { params: Promise.resolve({ id: EVENT }) };
  const put = () =>
    PUT(
      new NextRequest(`http://localhost/api/event-requests/${EVENT}/equipment-request/suitability`, {
        method: 'PUT',
        body: JSON.stringify({ verdicts: [{ lineId: PROJECTOR, suitability: 'suitable' }] }),
      }),
      ctx,
    );
  const post = () => POST(new Request(`http://localhost/api/event-requests/${EVENT}/equipment-request/review`, { method: 'POST' }), ctx);

  beforeEach(() => {
    vi.mocked(saveEquipmentSuitability).mockReset();
    vi.mocked(completeEquipmentReview).mockReset();
  });

  it.each<Role>(['coordinator', 'venue_staff', 'event_organiser'])('TC-171-05 refuses %s with 403 before the service is called', async (role) => {
    asRole([role]);
    expect((await put()).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect(saveEquipmentSuitability).not.toHaveBeenCalled();
    expect(completeEquipmentReview).not.toHaveBeenCalled();
  });

  it('refuses a caller who is not signed in with 401', async () => {
    vi.mocked(getCurrentActor).mockRejectedValue(new UnauthenticatedError());
    expect((await put()).status).toBe(401);
    expect((await post()).status).toBe(401);
  });

  it('passes Technical Support Staff and the body through to the service', async () => {
    asRole(['technical_support']);
    vi.mocked(saveEquipmentSuitability).mockResolvedValue({} as never);
    vi.mocked(completeEquipmentReview).mockResolvedValue({ request: {}, notReady: [] } as never);
    expect((await put()).status).toBe(200);
    expect(saveEquipmentSuitability).toHaveBeenCalledWith(EVENT, expect.objectContaining({ roles: ['technical_support'] }), {
      verdicts: [{ lineId: PROJECTOR, suitability: 'suitable' }],
    });
    expect((await post()).status).toBe(200);
    expect(completeEquipmentReview).toHaveBeenCalledWith(EVENT, expect.objectContaining({ roles: ['technical_support'] }));
  });
});
