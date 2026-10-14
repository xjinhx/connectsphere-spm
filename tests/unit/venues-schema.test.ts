import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  CreateVenueInputSchema,
  UpdateVenueInputSchema,
  VenueListQuerySchema,
  OPERATING_SLOTS,
  CAPACITY_COLUMN_MAX,
} from '@/domain/venues/schema';

/**
 * Venue Catalogue schema rules.
 *
 * Acceptance criteria are quoted from Jira, which is authoritative. Test case
 * IDs come from ConnectSphere_Test_Cases_v3, whose AC numbering differs from
 * Jira's because the sheet merges SCRUM-116 and SCRUM-117 into US-11.1.
 */

const LOCATION_ID = '11111111-1111-4111-8111-111111111111';
const FACILITY_ID = '22222222-2222-4222-8222-222222222222';
const FEATURE_ID = '33333333-3333-4333-8333-333333333333';

/** The minimum a Venue Staff member must supply (SCRUM-116 AC1). */
const validVenue = () => ({
  name: 'Hall A',
  locationId: LOCATION_ID,
  maxCapacity: 150,
});

const messagesFrom = (result: z.SafeParseReturnType<unknown, unknown>): string[] =>
  result.success ? [] : result.error.issues.map((issue: z.ZodIssue) => issue.message);

describe('CreateVenueInputSchema: SCRUM-116 AC1 name, location and capacity', () => {
  it('accepts a venue with only a name, location and capacity', () => {
    const result = CreateVenueInputSchema.safeParse(validVenue());
    expect(result.success).toBe(true);
  });

  it('requires a location chosen from the maintained list', () => {
    const result = CreateVenueInputSchema.safeParse({ name: 'Hall A', maxCapacity: 150 });
    expect(messagesFrom(result)).toContain('Location is required.');
  });

  it('rejects a blank name', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), name: '   ' });
    expect(messagesFrom(result)).toContain('Venue name is required.');
  });
});

describe('CreateVenueInputSchema: SCRUM-116 AC3 maximum capacity', () => {
  // US-11.1-TC03: a capacity that is not a whole number is blocked
  it('US-11.1-TC03 rejects a non-numeric capacity', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), maxCapacity: 'abc' });
    expect(messagesFrom(result)).toContain('Maximum capacity must be a whole number.');
  });

  // US-11.1-TC03: a fractional capacity is blocked
  it('US-11.1-TC03 rejects a fractional capacity', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), maxCapacity: 150.5 });
    expect(messagesFrom(result)).toContain('Maximum capacity must be a whole number.');
  });

  // US-11.1-TC04: capacity boundary, 0 versus 1
  it('US-11.1-TC04 rejects a capacity of 0', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), maxCapacity: 0 });
    expect(messagesFrom(result)).toContain('Maximum capacity must be greater than 0.');
  });

  it('US-11.1-TC04 accepts a capacity of 1', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), maxCapacity: 1 });
    expect(result.success).toBe(true);
  });

  // Found reviewing SCRUM-215: this passed here and failed in Postgres with a
  // message the form could not pin on the capacity field.
  it('flags a capacity too large for the database column on the field', () => {
    const tooBig = CreateVenueInputSchema.safeParse({ ...validVenue(), maxCapacity: CAPACITY_COLUMN_MAX + 1 });
    expect(tooBig.success).toBe(false);
    expect(tooBig.success ? {} : tooBig.error.flatten().fieldErrors).toHaveProperty('maxCapacity', [
      'Maximum capacity is too large.',
    ]);
    expect(CreateVenueInputSchema.safeParse({ ...validVenue(), maxCapacity: CAPACITY_COLUMN_MAX }).success).toBe(true);
  });
});

describe('CreateVenueInputSchema: SCRUM-116 AC4 operating slots', () => {
  it('defaults to all three slots when none are given', () => {
    const result = CreateVenueInputSchema.safeParse(validVenue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operatingSlots).toEqual([...OPERATING_SLOTS]);
    }
  });

  // US-11.1-TC05a: a venue saved without Night shows Night as not operating
  it('US-11.1-TC05a keeps only the slots that were selected', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), operatingSlots: ['am', 'pm'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operatingSlots).toEqual(['am', 'pm']);
      expect(result.data.operatingSlots).not.toContain('night');
    }
  });

  it('rejects an empty slot selection', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), operatingSlots: [] });
    expect(messagesFrom(result)).toContain('Select at least one operating slot.');
  });

  it('rejects the same slot twice', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), operatingSlots: ['am', 'am'] });
    expect(messagesFrom(result)).toContain('Each operating slot can only be selected once.');
  });

  it('rejects a slot outside AM, PM and Night', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), operatingSlots: ['dawn'] });
    expect(result.success).toBe(false);
  });
});

describe('CreateVenueInputSchema: SCRUM-117 facilities and accessibility features', () => {
  it('SCRUM-117 AC1 and AC2 default both lists to empty', () => {
    const result = CreateVenueInputSchema.safeParse(validVenue());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facilityIds).toEqual([]);
      expect(result.data.accessibilityFeatureIds).toEqual([]);
    }
  });

  it('SCRUM-117 AC1 accepts facilities chosen from the reference list', () => {
    const result = CreateVenueInputSchema.safeParse({ ...validVenue(), facilityIds: [FACILITY_ID] });
    expect(result.success).toBe(true);
  });

  it('SCRUM-117 AC2 accepts accessibility features', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      accessibilityFeatureIds: [FEATURE_ID],
    });
    expect(result.success).toBe(true);
  });

  it('rejects the same facility twice', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      facilityIds: [FACILITY_ID, FACILITY_ID],
    });
    expect(messagesFrom(result)).toContain('Each facility can only be selected once.');
  });
});

describe('CreateVenueInputSchema: SCRUM-118 AC1 layouts', () => {
  it('accepts a supported layout with its own capacity', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      layouts: [{ layout: 'theatre', capacity: 120 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects the same layout twice for one venue', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      layouts: [
        { layout: 'theatre', capacity: 120 },
        { layout: 'theatre', capacity: 90 },
      ],
    });
    expect(messagesFrom(result)).toContain('Each layout can only be added once per venue.');
  });

  it('rejects a layout capacity of 0', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      layouts: [{ layout: 'theatre', capacity: 0 }],
    });
    expect(messagesFrom(result)).toContain('Layout capacity must be greater than 0.');
  });

  it('rejects a layout capacity too large for the database column', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      layouts: [{ layout: 'theatre', capacity: CAPACITY_COLUMN_MAX + 1 }],
    });
    expect(messagesFrom(result)).toContain('Layout capacity is too large.');
  });

  it('rejects a layout that is not on the supported list', () => {
    const result = CreateVenueInputSchema.safeParse({
      ...validVenue(),
      layouts: [{ layout: 'amphitheatre', capacity: 120 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateVenueInputSchema: SCRUM-120 AC1 and SCRUM-117 AC3', () => {
  // The updatedAt the edit form was loaded with; every update carries one.
  const LOADED_AT = '2026-09-23T06:30:00.123456+00:00';
  const edit = (changes: Record<string, unknown>) =>
    UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: LOADED_AT, ...changes });

  it('SCRUM-120 AC1 accepts a capacity change on its own', () => {
    const result = edit({ maxCapacity: 250 });
    expect(result.success).toBe(true);
  });

  it('leaves an omitted list undefined so it is not overwritten', () => {
    const result = edit({ maxCapacity: 250 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facilityIds).toBeUndefined();
      expect(result.data.layouts).toBeUndefined();
    }
  });

  // SCRUM-117 AC3: a removed facility is no longer part of the venue record.
  // Sending the list without it is how removal is expressed.
  it('SCRUM-117 AC3 treats an empty list as "remove them all"', () => {
    const result = edit({ facilityIds: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.facilityIds).toEqual([]);
    }
  });

  it('refuses an update that changes nothing', () => {
    const result = edit({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toContain('Nothing to update.');
    }
  });

  it('refuses a confirmation flag with no actual change', () => {
    const result = edit({ confirmAffectedBookings: true });
    expect(result.success).toBe(false);
  });

  // Found reviewing SCRUM-215: without the version the form was loaded with,
  // a save from an out-of-date form silently undid a newer one.
  it('refuses an update that does not say which version of the venue it was made from', () => {
    const result = UpdateVenueInputSchema.safeParse({ maxCapacity: 250 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors).toHaveProperty('expectedUpdatedAt');
    }
  });

  it('accepts the version exactly as the venue page returns it, and refuses anything else', () => {
    expect(edit({ maxCapacity: 250 }).success).toBe(true);
    expect(edit({ maxCapacity: 250, expectedUpdatedAt: '2026-09-23T06:30:00Z' }).success).toBe(true);
    expect(edit({ maxCapacity: 250, expectedUpdatedAt: 'yesterday' }).success).toBe(false);
  });
});

describe('UpdateVenueInputSchema: SCRUM-119 (revised) setup and turnaround slot flags', () => {
  const validUpdate = () => ({
    expectedUpdatedAt: '2026-09-25T00:00:00.000Z',
    needsSetupSlot: true,
    needsTurnaroundSlot: true,
  });

  // TC-119-01: both flags true
  it('TC-119-01 accepts both flags as true', () => {
    const result = UpdateVenueInputSchema.safeParse(validUpdate());
    expect(result.success).toBe(true);
  });

  // TC-119-02: both flags false
  it('TC-119-02 accepts both flags as false', () => {
    const result = UpdateVenueInputSchema.safeParse({
      ...validUpdate(),
      needsSetupSlot: false,
      needsTurnaroundSlot: false,
    });
    expect(result.success).toBe(true);
  });

  // TC-119-03: one true, one false - each flag is independent
  it('TC-119-03 accepts one flag true and the other false', () => {
    const result = UpdateVenueInputSchema.safeParse({
      ...validUpdate(),
      needsSetupSlot: true,
      needsTurnaroundSlot: false,
    });
    expect(result.success).toBe(true);
  });

  // TC-119-04: a non-boolean value is refused
  it('TC-119-04 rejects a non-boolean needsSetupSlot value', () => {
    const result = UpdateVenueInputSchema.safeParse({ ...validUpdate(), needsSetupSlot: 'yes' });
    expect(result.success).toBe(false);
  });

  it('TC-119-04 rejects a non-boolean needsTurnaroundSlot value', () => {
    const result = UpdateVenueInputSchema.safeParse({ ...validUpdate(), needsTurnaroundSlot: 'yes' });
    expect(result.success).toBe(false);
  });
});

describe('VenueListQuerySchema: SCRUM-121 AC3 retired venues', () => {
  // US-11.3-TC03: the default filter excludes retired venues
  it('US-11.3-TC03 excludes retired venues when the flag is absent', () => {
    const result = VenueListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.includeRetired).toBe(false);
    }
  });

  it('US-11.3-TC03 includes retired venues only when the flag is "true"', () => {
    const included = VenueListQuerySchema.safeParse({ includeRetired: 'true' });
    const excluded = VenueListQuerySchema.safeParse({ includeRetired: 'false' });
    expect(included.success && included.data.includeRetired).toBe(true);
    expect(excluded.success && excluded.data.includeRetired).toBe(false);
  });
});

/**
 * SCRUM-239 AC1 (Jira): "Given I am Venue Staff editing a venue, when I set
 * opening and closing times in 15-minute steps and save, then they replace the
 * venue's slot configuration".
 */
describe('UpdateVenueInputSchema: SCRUM-239 AC1 opening hours', () => {
  const LOADED_AT = '2026-10-13T02:30:00.123456+00:00';
  const edit = (changes: Record<string, unknown>) =>
    UpdateVenueInputSchema.safeParse({ expectedUpdatedAt: LOADED_AT, ...changes });
  const fieldErrors = (result: z.SafeParseReturnType<unknown, unknown>) =>
    result.success ? {} : result.error.flatten().fieldErrors;

  it('TC-239-01: accepts 08:00 to 22:00', () => {
    expect(edit({ opensAt: '08:00', closesAt: '22:00' }).success).toBe(true);
  });

  it('accepts a venue open until midnight (24:00)', () => {
    expect(edit({ opensAt: '07:00', closesAt: '24:00' }).success).toBe(true);
  });

  it('TC-239-02: refuses an opening time off the 15-minute step, on that field', () => {
    expect(fieldErrors(edit({ opensAt: '08:10', closesAt: '22:00' }))).toEqual({
      opensAt: ['Choose a time on a 15-minute step (:00, :15, :30 or :45).'],
    });
  });

  it('refuses a closing time off the 15-minute step, on that field', () => {
    expect(fieldErrors(edit({ opensAt: '08:00', closesAt: '21:50' }))).toEqual({
      closesAt: ['Choose a time on a 15-minute step (:00, :15, :30 or :45).'],
    });
  });

  it('refuses closing at or before opening, on both fields', () => {
    const message = 'The closing time must be after the opening time.';
    expect(fieldErrors(edit({ opensAt: '22:00', closesAt: '08:00' }))).toEqual({ opensAt: [message], closesAt: [message] });
    expect(fieldErrors(edit({ opensAt: '10:00', closesAt: '10:00' }))).toEqual({ opensAt: [message], closesAt: [message] });
  });

  it('needs both times together', () => {
    expect(fieldErrors(edit({ opensAt: '08:00' }))).toEqual({ closesAt: ['Set both the opening and the closing time.'] });
  });

  it('an edit that leaves the hours out keeps them (nothing to check)', () => {
    expect(edit({ maxCapacity: 250 }).success).toBe(true);
  });
});

describe('CreateVenueInputSchema: SCRUM-239 AC1 opening hours on a new venue', () => {
  it('accepts a new venue with its hours', () => {
    expect(CreateVenueInputSchema.safeParse({ ...validVenue(), opensAt: '08:00', closesAt: '22:00' }).success).toBe(true);
  });

  it('still accepts one without hours (filled from the slots, as before)', () => {
    expect(CreateVenueInputSchema.safeParse(validVenue()).success).toBe(true);
  });

  it('refuses hours off the 15-minute step', () => {
    expect(CreateVenueInputSchema.safeParse({ ...validVenue(), opensAt: '08:10', closesAt: '22:00' }).success).toBe(false);
  });
});
