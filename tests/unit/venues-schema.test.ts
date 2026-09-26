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

describe('UpdateVenueInputSchema: SCRUM-119 AC1 setup, teardown and turnaround minutes', () => {
  const validUpdate = () => ({
    expectedUpdatedAt: '2026-09-25T00:00:00.000Z',
    setupMinutes: 15,
    teardownMinutes: 20,
    turnaroundMinutes: 30,
  });

  it('accepts valid setup, teardown and turnaround minutes', () => {
    const result = UpdateVenueInputSchema.safeParse(validUpdate());
    expect(result.success).toBe(true);
  });

  // TC-119-02: the lower boundary, 0, is accepted for each field
  it('TC-119-02 accepts 0 minutes for each field', () => {
    const result = UpdateVenueInputSchema.safeParse({
      ...validUpdate(),
      setupMinutes: 0,
      teardownMinutes: 0,
      turnaroundMinutes: 0,
    });
    expect(result.success).toBe(true);
  });

  // TC-119-03: the upper boundary, 240, is accepted for each field
  it('TC-119-03 accepts 240 minutes for each field', () => {
    const result = UpdateVenueInputSchema.safeParse({
      ...validUpdate(),
      setupMinutes: 240,
      teardownMinutes: 240,
      turnaroundMinutes: 240,
    });
    expect(result.success).toBe(true);
  });

  // TC-119-04: just below the lower boundary is refused
  it('TC-119-04 rejects a negative turnaround', () => {
    const result = UpdateVenueInputSchema.safeParse({ ...validUpdate(), turnaroundMinutes: -1 });
    expect(messagesFrom(result)).toContain('Turnaround time must be 0 minutes or more.');
  });

  // TC-119-05: just above the upper boundary is refused
  it('TC-119-05 rejects a setup time above 240', () => {
    const result = UpdateVenueInputSchema.safeParse({ ...validUpdate(), setupMinutes: 241 });
    expect(messagesFrom(result)).toContain('Setup time must be 240 minutes or less.');
  });

  // TC-119-06: a non-whole-number value is refused
  it('TC-119-06 rejects a fractional teardown time', () => {
    const result = UpdateVenueInputSchema.safeParse({ ...validUpdate(), teardownMinutes: 15.5 });
    expect(messagesFrom(result)).toContain('Teardown time must be a whole number of minutes.');
  });

  it('rejects a non-numeric turnaround value', () => {
    const result = UpdateVenueInputSchema.safeParse({ ...validUpdate(), turnaroundMinutes: 'abc' });
    expect(messagesFrom(result)).toContain('Turnaround time must be a whole number of minutes.');
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
