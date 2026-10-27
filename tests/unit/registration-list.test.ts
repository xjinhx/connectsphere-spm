import { describe, expect, it } from 'vitest';
import {
  EXPORT_HEADERS,
  canExportRegistrationList,
  exportFileName,
  hasRegistrationList,
  placesRemaining,
  registeredCount,
  registrationDate,
  registrationListCsv,
  registrationListViewer,
} from '@/domain/registration-list/policy';
import type { RegistrationListEntry } from '@/domain/registration-list/schema';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-185 AC1-AC4 — the rules behind the registration list: who sees it and
 * as what, the counts, and the export. Test case IDs match the SCRUM-185 tab
 * of the Sprint 4 sheet. The reads against the real database are in
 * tests/integration/registration-list-view.test.ts.
 */

const COORDINATOR = 'c0000000-0000-4000-8000-000000000001';
const OTHER_COORDINATOR = 'c0000000-0000-4000-8000-000000000002';
const ORGANISER = 'e0000000-0000-4000-8000-000000000001';
const COLLEAGUE = 'e0000000-0000-4000-8000-000000000002';
const STRANGER = 'e0000000-0000-4000-8000-000000000003';
const ORG = '22222222-2222-2222-2222-222222222222';
const OTHER_ORG = '55555555-5555-4555-8555-555555555555';

const EVENT = {
  status: 'confirmed' as const,
  coordinatorId: COORDINATOR,
  organiserId: ORGANISER,
  clientOrganisationId: ORG,
};

const viewer = (userId: string, roles: Role[], clientOrganisationId: string | null = null) =>
  registrationListViewer(EVENT, { userId, roles, clientOrganisationId });

function entry(n: number, status: 'registered' | 'withdrawn' = 'registered', overrides: Partial<RegistrationListEntry> = {}): RegistrationListEntry {
  return {
    id: `r${n}`,
    reference: `REG-2026-000${n}`,
    eventRequestId: 'ev',
    fullName: `Attendee ${n}`,
    email: `attendee${n}@example.com`,
    contactNumber: `+65 9000 000${n}`,
    status,
    // 23:30 UTC on 31 Oct is 07:30 on 1 Nov in Singapore.
    registeredAt: '2026-10-31T23:30:00Z',
    ...overrides,
  };
}

describe('SCRUM-185 AC1-AC4: who may open the list, and as what', () => {
  it('SCRUM-185 AC1 TC-185-07 the assigned coordinator', () => {
    expect(viewer(COORDINATOR, ['coordinator'])).toBe('coordinator');
  });

  it('a coordinator the event is not assigned to is denied', () => {
    expect(viewer(OTHER_COORDINATOR, ['coordinator'])).toBeNull();
  });

  it('the Event Coordinator Lead, read-only', () => {
    expect(viewer(OTHER_COORDINATOR, ['operations_manager'])).toBe('lead');
  });

  it('SCRUM-185 AC2 TC-185-10 the responsible organiser', () => {
    expect(viewer(ORGANISER, ['event_organiser'], ORG)).toBe('organiser');
  });

  it('SCRUM-185 AC3 TC-185-11 an organiser in the same organisation', () => {
    expect(viewer(COLLEAGUE, ['event_organiser'], ORG)).toBe('colleague');
  });

  it('SCRUM-185 AC4 TC-185-13 an organiser of an unrelated organisation is denied', () => {
    expect(viewer(STRANGER, ['event_organiser'], OTHER_ORG)).toBeNull();
    expect(viewer(STRANGER, ['event_organiser'], null)).toBeNull();
  });

  it.each<Role>(['attendee', 'venue_staff', 'technical_support', 'safety_officer'])('%s is denied', (role) => {
    expect(viewer(STRANGER, [role], ORG)).toBeNull();
  });
});

describe('SCRUM-185 AC2, AC3: only the responsible organiser exports', () => {
  it('SCRUM-185 AC2 TC-185-10 the responsible organiser may', () => {
    expect(canExportRegistrationList('organiser')).toBe(true);
  });

  it('SCRUM-185 AC3 TC-185-12 a colleague may not, nor anyone else', () => {
    for (const who of ['colleague', 'coordinator', 'lead', null] as const) {
      expect(canExportRegistrationList(who)).toBe(false);
    }
  });
});

describe('SCRUM-185 AC1: the counts', () => {
  it('SCRUM-185 AC1 TC-185-07 capacity 250, three registered: 247 remain', () => {
    expect(placesRemaining(250, 3)).toBe(247);
  });

  it('SCRUM-185 AC1 TC-185-08 none registered: all 250 remain', () => {
    expect(placesRemaining(250, 0)).toBe(250);
  });

  it('SCRUM-185 AC1 TC-185-09 a full event: none remain', () => {
    expect(placesRemaining(2, 2)).toBe(0);
  });

  it('a capacity lowered below the number registered shows none, never negative (SCRUM-182)', () => {
    expect(placesRemaining(2, 3)).toBe(0);
  });

  it('no capacity set: nothing to count against', () => {
    expect(placesRemaining(null, 0)).toBeNull();
  });

  it('a withdrawn registration is listed but not counted (SCRUM-182 AC3)', () => {
    expect(registeredCount([entry(1), entry(2, 'withdrawn'), entry(3)])).toBe(2);
  });
});

describe('SCRUM-185 AC1: the registration date', () => {
  it('is the Singapore date, as DD/MM/YYYY', () => {
    expect(registrationDate('2026-10-31T23:30:00Z')).toBe('01/11/2026');
  });
});

describe('SCRUM-185 AC2: the export', () => {
  it('SCRUM-185 AC2 TC-185-10 a header and one row per registration, with date and status', () => {
    expect(registrationListCsv([entry(1), entry(2, 'withdrawn')])).toBe(
      [
        EXPORT_HEADERS.join(','),
        "REG-2026-0001,Attendee 1,attendee1@example.com,'+65 9000 0001,01/11/2026,Registered",
        "REG-2026-0002,Attendee 2,attendee2@example.com,'+65 9000 0002,01/11/2026,Withdrawn",
        '',
      ].join('\r\n'),
    );
  });

  it('an empty list is the header only', () => {
    expect(registrationListCsv([])).toBe(`${EXPORT_HEADERS.join(',')}\r\n`);
  });

  it('quotes commas, quotes and line breaks', () => {
    const csv = registrationListCsv([entry(1, 'registered', { fullName: 'Tan, "Mei"\nLing' })]);
    expect(csv.split('\r\n')[1]).toBe(
      `REG-2026-0001,"Tan, ""Mei""\nLing",attendee1@example.com,'+65 9000 0001,01/11/2026,Registered`,
    );
  });

  it('a contact number starting with + is kept as text, not worked out as a formula', () => {
    expect(registrationListCsv([entry(1)]).split('\r\n')[1]?.split(',')[3]).toBe("'+65 9000 0001");
  });

  it('a value a spreadsheet would run as a formula is opened with a quote', () => {
    const csv = registrationListCsv([entry(1, 'registered', { fullName: '=HYPERLINK("x")' })]);
    expect(csv.split('\r\n')[1]?.split(',')[1]).toBe(`"'=HYPERLINK(""x"")"`);
  });

  it('the file name comes from the event reference', () => {
    expect(exportFileName('EVT-2026-0759')).toBe('registrations-EVT-2026-0759.csv');
  });
});

describe('where the list is offered', () => {
  it('from Confirmed on, when registration can be open', () => {
    expect(hasRegistrationList('confirmed')).toBe(true);
    expect(hasRegistrationList('preparation')).toBe(true);
    expect(hasRegistrationList('completed')).toBe(true);
    for (const status of ['draft', 'submitted', 'approved', 'planning', 'cancelled'] as const) {
      expect(hasRegistrationList(status)).toBe(false);
    }
  });
});
