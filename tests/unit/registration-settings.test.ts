import { describe, expect, it } from 'vitest';
import {
  acceptsRegistrationSettings,
  canEditRegistrationSettings,
  capacityOverVenueMessage,
  largestVenueCapacity,
  notConfirmedNotice,
} from '@/domain/registration-list/policy';
import {
  CAPACITY_MESSAGE,
  END_BEFORE_START_MESSAGE,
  END_DATE_MESSAGE,
  RegistrationSettingsInputSchema,
  START_DATE_MESSAGE,
} from '@/domain/registration-list/schema';
import { ROLE_PERMISSIONS } from '@/domain/identity/permissions';

/**
 * SCRUM-185 AC5, AC6 — the rules behind setting an event's registration start
 * date, end date and capacity. Test case IDs match the SCRUM-185 tab of the
 * Sprint 4 sheet. The saves against the real database are in
 * tests/integration/registration-list.test.ts.
 */

const COORDINATOR = 'c0000000-0000-4000-8000-000000000001';
const OTHER = 'c0000000-0000-4000-8000-000000000002';

function fieldErrors(input: unknown) {
  const parsed = RegistrationSettingsInputSchema.safeParse(input);
  return parsed.success ? {} : parsed.error.flatten().fieldErrors;
}

describe('SCRUM-185 AC5: who may set registration, and when', () => {
  it('SCRUM-185 AC5 TC-185-08 the assigned coordinator of a Confirmed event may', () => {
    expect(canEditRegistrationSettings({ status: 'confirmed', coordinatorId: COORDINATOR }, COORDINATOR)).toBe(true);
  });

  it('SCRUM-185 AC5 TC-185-09 not before the event is Confirmed', () => {
    for (const status of ['submitted', 'approved', 'planning'] as const) {
      expect(acceptsRegistrationSettings(status)).toBe(false);
      expect(canEditRegistrationSettings({ status, coordinatorId: COORDINATOR }, COORDINATOR)).toBe(false);
    }
  });

  it('SCRUM-185 AC5 TC-185-11 read-only from Preparation on (CL-65)', () => {
    for (const status of ['preparation', 'completed', 'cancelled'] as const) {
      expect(acceptsRegistrationSettings(status)).toBe(false);
      expect(canEditRegistrationSettings({ status, coordinatorId: COORDINATOR }, COORDINATOR)).toBe(false);
    }
    expect(notConfirmedNotice('preparation')).toBe(
      'This event is Preparation. Its registration dates and capacity are read-only from Preparation on.',
    );
    expect(notConfirmedNotice('planning')).toBe('This event is Planning. Registration is set once the event is Confirmed.');
  });

  it('SCRUM-185 AC5 TC-185-10 not a coordinator the event is not assigned to', () => {
    expect(canEditRegistrationSettings({ status: 'confirmed', coordinatorId: COORDINATOR }, OTHER)).toBe(false);
  });

  it('only the coordinator role holds the permission', () => {
    const holders = Object.entries(ROLE_PERMISSIONS)
      .filter(([, actions]) => actions.includes('registration_settings_edit'))
      .map(([role]) => role);
    expect(holders).toEqual(['coordinator']);
  });
});

describe('SCRUM-185 AC5: the three fields', () => {
  it('SCRUM-185 AC5 TC-185-08 accepts a start date, end date and capacity', () => {
    expect(
      RegistrationSettingsInputSchema.parse({ startDate: '2026-11-01', endDate: '2026-11-15', capacity: '250' }),
    ).toEqual({ startDate: '2026-11-01', endDate: '2026-11-15', capacity: 250 });
  });

  it('accepts a one-day period (start = end), as 181 does', () => {
    expect(fieldErrors({ startDate: '2026-11-01', endDate: '2026-11-01', capacity: 1 })).toEqual({});
  });

  it('names each missing field', () => {
    expect(fieldErrors({ startDate: '', endDate: '', capacity: '' })).toEqual({
      startDate: [START_DATE_MESSAGE],
      endDate: [END_DATE_MESSAGE],
      capacity: [CAPACITY_MESSAGE],
    });
  });

  it('refuses a date that does not exist or has a five-digit year', () => {
    expect(fieldErrors({ startDate: '2026-02-30', endDate: '20266-11-15', capacity: 10 })).toEqual({
      startDate: [START_DATE_MESSAGE],
      endDate: [END_DATE_MESSAGE],
    });
  });

  it.each(['0', '-5', '2.5', 'ten'])('refuses capacity %s', (capacity) => {
    expect(fieldErrors({ startDate: '2026-11-01', endDate: '2026-11-15', capacity })).toEqual({
      capacity: [CAPACITY_MESSAGE],
    });
  });
});

describe('SCRUM-185 AC6: refused with a message naming the field', () => {
  it('SCRUM-185 AC6 TC-185-12 an end date before the start date fails on the end date', () => {
    expect(fieldErrors({ startDate: '2026-11-15', endDate: '2026-11-01', capacity: 50 })).toEqual({
      endDate: [END_BEFORE_START_MESSAGE],
    });
  });

  it('SCRUM-185 AC6 TC-185-13 one venue: its capacity is the limit', () => {
    expect(largestVenueCapacity([300])).toBe(300);
  });

  it('SCRUM-185 AC6 TC-185-14 several venues: the largest of their capacities (CL-59)', () => {
    expect(largestVenueCapacity([300, 200])).toBe(300);
    expect(largestVenueCapacity([200, 300])).toBe(300);
  });

  it('SCRUM-185 AC6 TC-185-17 an end date after the event date is accepted (CL-66: AC6 refuses only its two cases)', () => {
    expect(fieldErrors({ startDate: '2026-11-01', endDate: '2027-01-31', capacity: 50 })).toEqual({});
  });

  it('SCRUM-185 AC6 TC-185-16 no confirmed venue: no limit to check against', () => {
    expect(largestVenueCapacity([])).toBeNull();
  });

  it('the over-capacity message names capacity and the limit', () => {
    expect(capacityOverVenueMessage(300)).toBe(
      "Capacity must be no more than 300, the largest capacity of this event's venues.",
    );
  });
});
