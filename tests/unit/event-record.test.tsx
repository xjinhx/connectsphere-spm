import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-109 View the full event record (Jira, authoritative):
 *   AC1 Given I open an event I am permitted to view, when the page loads, then
 *       event details, status, assigned coordinator, venue arrangement,
 *       equipment arrangement and registration setting are shown in one place.
 *   AC2 Given a section contains information my role may not see, when the
 *       page loads, then that section is omitted rather than shown empty.
 *   AC3 Given I am the Event Coordinator Lead, when I open any active event,
 *       then I can view its status and which arrangements are marked
 *       essential, with whether each is complete, and no action to change them
 *       is offered.
 *
 * The rules (who is related, which sections each sees, whether an essential
 * arrangement is complete) on their own, and the page rendered for real with
 * only the session and the record read replaced. The reads against a real
 * database are in tests/integration/event-record.test.ts. Test case IDs match
 * the SCRUM-109 tab of the Sprint 4 sheet.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/event-record/service', () => ({ getEventRecord: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getEventRecord } from '@/domain/event-record/service';
import {
  EVENT_RECORD_SECTIONS,
  NO_ACCESS_MESSAGE,
  canSeeCoordinatorContact,
  eventRecordViewers,
  sectionsVisibleTo,
  type EventRecordViewer,
} from '@/domain/event-record/policy';
import type { EventRecord } from '@/domain/event-record/schema';
import {
  NO_ARRANGEMENTS_RECORDED,
  REGISTRATION_NOT_SET,
  essentialArrangementProgress,
} from '@/domain/essential-arrangements/policy';
import type { ConfirmationSnapshot } from '@/domain/essential-arrangements/schema';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { EventRequest } from '@/domain/event-request/service';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError } from '@/domain/shared/errors';
import EventRecordPage from '@/app/events/[id]/record/page';

const ORGANISER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COLLEAGUE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COORDINATOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SOMEONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const HARBOUR = '11111111-1111-4111-8111-111111111111';
const LION_CITY = '22222222-2222-4222-8222-222222222222';

function event(overrides: Partial<Parameters<typeof eventRecordViewers>[0]> = {}) {
  return {
    organiserId: ORGANISER,
    clientOrganisationId: HARBOUR,
    coordinatorId: COORDINATOR,
    status: 'confirmed' as EventRequestStatus,
    hasBookingRequest: true,
    hasEquipmentRequest: true,
    ...overrides,
  };
}

const actor = (userId: string, roles: Role[], clientOrganisationId: string | null = null) => ({
  userId,
  roles,
  clientOrganisationId,
});

describe('SCRUM-109 AC1: who may open an event record', () => {
  it('SCRUM-109 AC1 TC-109-01 the assigned coordinator is related as the coordinator', () => {
    expect(eventRecordViewers(event(), actor(COORDINATOR, ['coordinator']))).toEqual(['coordinator']);
  });

  it('SCRUM-109 AC1 TC-109-02 the responsible organiser is related as the organiser', () => {
    expect(eventRecordViewers(event(), actor(ORGANISER, ['event_organiser'], HARBOUR))).toEqual(['organiser']);
  });

  it('SCRUM-109 AC1 TC-109-04 an organiser of another client organisation is not related', () => {
    expect(eventRecordViewers(event(), actor(SOMEONE, ['event_organiser'], LION_CITY))).toEqual([]);
  });

  it('SCRUM-109 AC1 TC-109-05 a coordinator the event is not assigned to is not related', () => {
    expect(eventRecordViewers(event(), actor(SOMEONE, ['coordinator']))).toEqual([]);
  });

  it("a draft stays its owner's: a colleague and the Lead are not related to it", () => {
    const draft = event({ status: 'draft', coordinatorId: null, hasBookingRequest: false, hasEquipmentRequest: false });
    expect(eventRecordViewers(draft, actor(COLLEAGUE, ['event_organiser'], HARBOUR))).toEqual([]);
    expect(eventRecordViewers(draft, actor(SOMEONE, ['operations_manager']))).toEqual([]);
    expect(eventRecordViewers(draft, actor(ORGANISER, ['event_organiser'], HARBOUR))).toEqual(['organiser']);
  });

  it('an attendee or a Safety Officer is not related, whatever the event has', () => {
    expect(eventRecordViewers(event(), actor(SOMEONE, ['attendee']))).toEqual([]);
    expect(eventRecordViewers(event(), actor(SOMEONE, ['safety_officer']))).toEqual([]);
  });
});

describe('SCRUM-109 AC2: each role sees only its sections', () => {
  it('SCRUM-109 AC2 TC-109-06 Venue Staff: the coordinator (name only) and the venue arrangement', () => {
    const viewers = eventRecordViewers(event(), actor(SOMEONE, ['venue_staff']));
    expect(viewers).toEqual(['venue_staff']);
    expect(sectionsVisibleTo(viewers)).toEqual(['coordinator', 'venue']);
    expect(canSeeCoordinatorContact(viewers)).toBe(false);
  });

  it('SCRUM-109 AC2 TC-109-07 Technical Support: the coordinator (name only), venue and equipment', () => {
    const viewers = eventRecordViewers(event(), actor(SOMEONE, ['technical_support']));
    expect(viewers).toEqual(['technical_support']);
    expect(sectionsVisibleTo(viewers)).toEqual(['coordinator', 'venue', 'equipment']);
    expect(canSeeCoordinatorContact(viewers)).toBe(false);
  });

  it('SCRUM-109 AC2 TC-109-08 the organiser: no internal information and no essential set', () => {
    const sections = sectionsVisibleTo(['organiser']);
    expect(sections).toEqual(['coordinator', 'venue', 'equipment', 'registration']);
    expect(sections).not.toContain('internal');
    expect(sections).not.toContain('essential');
  });

  it('SCRUM-109 AC2 TC-109-09 a colleague in the same organisation: no coordinator (SCRUM-204 AC3)', () => {
    const viewers = eventRecordViewers(event(), actor(COLLEAGUE, ['event_organiser'], HARBOUR));
    expect(viewers).toEqual(['colleague']);
    expect(sectionsVisibleTo(viewers)).toEqual(['venue', 'equipment', 'registration']);
  });

  it('SCRUM-109 AC2 TC-109-10 Venue Staff and Technical Support are related only through a request (#66)', () => {
    const unrequested = event({ hasBookingRequest: false, hasEquipmentRequest: false });
    expect(eventRecordViewers(unrequested, actor(SOMEONE, ['venue_staff']))).toEqual([]);
    expect(eventRecordViewers(unrequested, actor(SOMEONE, ['technical_support']))).toEqual([]);
  });

  it('the coordinator and the Lead see every section', () => {
    expect(sectionsVisibleTo(['coordinator'])).toEqual([...EVENT_RECORD_SECTIONS]);
    expect(sectionsVisibleTo(['lead'])).toEqual([...EVENT_RECORD_SECTIONS]);
  });

  it('an account related in two ways sees what either gives it', () => {
    const viewers = eventRecordViewers(event(), actor(SOMEONE, ['venue_staff', 'technical_support']));
    expect(sectionsVisibleTo(viewers)).toEqual(['coordinator', 'venue', 'equipment']);
  });
});

describe('SCRUM-109 AC3: the Lead and the essential arrangements', () => {
  const snapshot = (overrides: Partial<ConfirmationSnapshot> = {}): ConfirmationSnapshot => ({
    needs: { venue: 'essential', equipment: 'essential', technicalSupport: 'essential', registration: 'essential' },
    venueLines: [],
    venueBookings: [
      { id: 'b1', venueName: 'Marina Bay Ballroom', date: '2026-12-01', startTime: '10:00', endTime: '12:00', status: 'confirmed' },
    ],
    affectedBookings: [],
    equipment: { reservations: [{ status: 'reserved' }], outstanding: [] },
    ...overrides,
  });
  const noFlags = { bookings: [], reservations: [] };
  const registrationSet = { startDate: '2026-11-01', endDate: '2026-11-15', capacity: 250 };
  const registrationNotSet = { startDate: null, endDate: null, capacity: null };

  it('SCRUM-109 AC3 TC-109-11, TC-109-14 the Lead is related to any event past draft, with every section', () => {
    // Finished events too, as history (PO, 1 Nov): "active" in SCRUM-233 only
    // decides what the overview lists.
    for (const status of ['submitted', 'planning', 'confirmed', 'completed', 'cancelled', 'rejected'] as EventRequestStatus[]) {
      const viewers = eventRecordViewers(event({ status, coordinatorId: null }), actor(SOMEONE, ['operations_manager']));
      expect(viewers).toEqual(['lead']);
      expect(sectionsVisibleTo(viewers)).toContain('essential');
    }
  });

  it('SCRUM-109 AC3 TC-109-11 Planning: venue complete; equipment and registration not, each saying what is outstanding', () => {
    const progress = essentialArrangementProgress(
      snapshot({
        needs: { venue: 'essential', equipment: 'essential', technicalSupport: 'not_required', registration: 'essential' },
        equipment: { reservations: [], outstanding: [{ equipmentName: 'Projector P-100', outstanding: 2 }] },
      }),
      noFlags,
      registrationNotSet,
    );
    expect(progress).toEqual([
      { arrangement: 'venue', progress: 'complete', outstanding: [] },
      { arrangement: 'equipment', progress: 'not_complete', outstanding: ['Equipment: Projector P-100, 2 still to reserve.'] },
      { arrangement: 'registration', progress: 'not_complete', outstanding: [REGISTRATION_NOT_SET] },
    ]);
  });

  it('SCRUM-109 AC3 TC-109-12 Confirmed: venue, equipment and registration complete; technical support not recorded', () => {
    const progress = essentialArrangementProgress(snapshot(), noFlags, registrationSet);
    expect(progress.map(({ arrangement, progress: state }) => [arrangement, state])).toEqual([
      ['venue', 'complete'],
      ['equipment', 'complete'],
      ['technicalSupport', 'not_recorded'],
      ['registration', 'complete'],
    ]);
  });

  it('nothing marked essential lists nothing', () => {
    expect(essentialArrangementProgress(snapshot({ needs: NO_ARRANGEMENTS_RECORDED }), noFlags, registrationSet)).toEqual([]);
  });

  it('a venue with no booking, or a booking flagged for review, is not complete (as SCRUM-102 and SCRUM-190)', () => {
    const venueOnly = { ...NO_ARRANGEMENTS_RECORDED, venue: 'essential' as const };
    expect(essentialArrangementProgress(snapshot({ needs: venueOnly, venueBookings: [] }), noFlags, registrationSet)).toEqual([
      { arrangement: 'venue', progress: 'not_complete', outstanding: ['Venue: no venue booking has been approved.'] },
    ]);
    const flagged = { bookings: ['Marina Bay Ballroom, 01/12/2026, 10:00 to 12:00'], reservations: [] };
    expect(essentialArrangementProgress(snapshot({ needs: venueOnly }), flagged, registrationSet)[0]?.outstanding).toEqual([
      'Venue: Marina Bay Ballroom, 01/12/2026, 10:00 to 12:00 is marked for review.',
    ]);
  });
});

// -----------------------------------------------------------------------------
// The page
// -----------------------------------------------------------------------------

const details = {
  id: EVENT_ID,
  reference: 'EVT-2026-0109',
  organiserId: ORGANISER,
  clientOrganisationId: HARBOUR,
  name: 'S109 Harbour Gala',
  purpose: 'Client gala',
  description: 'Gala dinner',
  proposedDate: '2026-12-01',
  startTime: '10:00',
  endTime: '12:00',
  expectedAttendance: 150,
  status: 'confirmed',
  submittedAt: '2026-10-20T02:00:00Z',
  createdAt: '2026-10-20T01:00:00Z',
  updatedAt: '2026-10-20T02:00:00Z',
  roomLayout: null,
  accessibilityRequired: false,
  accessibilityFeatures: [],
  accessibilityNotes: null,
  preferredLocation: null,
  equipmentRequired: true,
  equipmentItems: [],
  technicalSupportNotes: null,
  registrationRequired: true,
} as unknown as EventRequest;

/** Every section, then trimmed to what `viewers` may see, as getEventRecord does. */
function recordFor(viewers: EventRecordViewer[]): EventRecord {
  const full: Required<EventRecord> = {
    id: EVENT_ID,
    reference: 'EVT-2026-0109',
    name: 'S109 Harbour Gala',
    status: 'confirmed',
    viewers,
    details,
    coordinator: { name: 'Coordinator', email: 'coordinator@example.com', contactNumber: '+65 6000 0000' },
    internal: { internalNotes: 'VIP table near stage', clientContactName: null, clientContactEmail: null, clientContactPhone: null },
    venue: {
      bookings: [{ venueName: 'Marina Bay Ballroom', date: '2026-12-01', startTime: '10:00', endTime: '12:00', status: 'confirmed' }],
      requests: [],
    },
    equipment: { status: 'fulfilled', lines: [{ equipmentName: 'Projector P-100', quantity: 2, reserved: true }] },
    registration: { required: true, startDate: '2026-11-01', endDate: '2026-11-15', capacity: 250 },
    essential: [{ arrangement: 'venue', progress: 'complete', outstanding: [] }],
  };
  const record: EventRecord = { ...full };
  const visible = new Set(sectionsVisibleTo(viewers));
  for (const section of EVENT_RECORD_SECTIONS) if (!visible.has(section)) delete record[section];
  return record;
}

async function renderPage(): Promise<string> {
  const element = (await EventRecordPage({ params: Promise.resolve({ id: EVENT_ID }) })) as ReactElement;
  return renderToStaticMarkup(element);
}

const HEADINGS = {
  coordinator: 'Assigned coordinator',
  internal: 'Internal information',
  venue: 'Venue arrangement',
  equipment: 'Equipment arrangement',
  registration: 'Registration setting',
  essential: 'Essential arrangements',
} as const;

describe('SCRUM-109: the event record page', () => {
  beforeEach(() => {
    vi.mocked(getCurrentActor).mockResolvedValue({ userId: SOMEONE, fullName: 'Someone', roles: [], clientOrganisation: null });
  });

  it('SCRUM-109 AC1 TC-109-01 the coordinator sees details, status and every section on one page', async () => {
    vi.mocked(getEventRecord).mockResolvedValue(recordFor(['coordinator']));
    const html = await renderPage();
    for (const text of ['S109 Harbour Gala', 'Confirmed', 'Event details', ...Object.values(HEADINGS)]) expect(html).toContain(text);
    expect(html).toContain('Marina Bay Ballroom, 01/12/2026, 10:00 to 12:00');
    expect(html).toContain('Projector P-100 × 2');
    expect(html).toContain('250');
  });

  it('SCRUM-109 AC1 TC-109-04 someone not related sees the refusal and nothing about the event', async () => {
    vi.mocked(getEventRecord).mockRejectedValue(new ForbiddenError(NO_ACCESS_MESSAGE));
    const html = await renderPage();
    expect(html).toContain(NO_ACCESS_MESSAGE);
    expect(html).not.toContain('S109 Harbour Gala');
  });

  it('SCRUM-109 AC2 TC-109-06 Venue Staff: no heading at all for the sections they may not see', async () => {
    vi.mocked(getEventRecord).mockResolvedValue(recordFor(['venue_staff']));
    const html = await renderPage();
    expect(html).toContain(HEADINGS.coordinator);
    expect(html).toContain(HEADINGS.venue);
    for (const heading of [HEADINGS.internal, HEADINGS.equipment, HEADINGS.registration, HEADINGS.essential]) {
      expect(html).not.toContain(heading);
    }
  });

  it('SCRUM-109 AC2 TC-109-08 the organiser: the internal notes are not on the page', async () => {
    vi.mocked(getEventRecord).mockResolvedValue(recordFor(['organiser']));
    const html = await renderPage();
    expect(html).not.toContain('VIP table near stage');
    expect(html).not.toContain(HEADINGS.internal);
    expect(html).not.toContain(HEADINGS.essential);
  });

  it('SCRUM-109 AC3 TC-109-13 the Lead sees the status and the essential set, and nothing to change anything', async () => {
    vi.mocked(getEventRecord).mockResolvedValue(recordFor(['lead']));
    const html = await renderPage();
    expect(html).toContain(HEADINGS.essential);
    expect(html).toContain('Complete');
    expect(html).not.toMatch(/<(button|form|input|select|textarea)\b/);
  });
});
