import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { ClockRangeSchema, EndTimeSchema, StartTimeSchema } from '@/domain/shared/times';

/**
 * Venue Catalogue (EP-08): data shapes shared by the API routes and the UI.
 *
 * SCRUM-116 Add a venue to the catalogue
 * SCRUM-117 Record facilities and accessibility features
 * SCRUM-118 Record supported room layouts and their capacities
 * SCRUM-120 Update venue information
 * SCRUM-121 Browse and view the venue catalogue
 * SCRUM-128 Search venues by date and slot
 * SCRUM-123 View a venue's calendar with the state of each slot
 * SCRUM-225 Record setup and turnaround time for each venue
 * SCRUM-239 Venue opening hours in 15-minute steps (AC1)
 *
 * Values mirror the check constraints in
 * supabase/migrations/20260911063000_create_venue_catalogue.sql.
 */

// -----------------------------------------------------------------------------
// Fixed value lists
// -----------------------------------------------------------------------------

/** The three fixed booking slots (forum #50). Stored lowercase, like profile roles. */
export const OPERATING_SLOTS = ['am', 'pm', 'night'] as const;
export const OperatingSlotSchema = z.enum(OPERATING_SLOTS);
export type OperatingSlot = z.infer<typeof OperatingSlotSchema>;

export const OPERATING_SLOT_LABELS: Record<OperatingSlot, string> = {
  am: 'AM (07:00-12:00)',
  pm: 'PM (13:00-18:00)',
  night: 'Night (19:00-24:00)',
};

/** Room layouts, matching the options on the event request form (US-02.4 AC1). */
export const ROOM_LAYOUTS = [
  'theatre',
  'classroom',
  'boardroom',
  'banquet',
  'u_shape',
  'cabaret',
  'standing',
] as const;
export const RoomLayoutSchema = z.enum(ROOM_LAYOUTS);
export type RoomLayout = z.infer<typeof RoomLayoutSchema>;

export const ROOM_LAYOUT_LABELS: Record<RoomLayout, string> = {
  theatre: 'Theatre',
  classroom: 'Classroom',
  boardroom: 'Boardroom',
  banquet: 'Banquet',
  u_shape: 'U-shape',
  cabaret: 'Cabaret',
  standing: 'Standing',
};

export const VENUE_NAME_MAX_LENGTH = 100;

// -----------------------------------------------------------------------------
// Building blocks
// -----------------------------------------------------------------------------

export const VenueIdSchema = z.string().uuid('Venue id must be a valid id.');

/**
 * The largest value the integer capacity columns can hold. Anything above it
 * used to pass here and then fail in Postgres with a generic error that the
 * form could not pin on the field. Not a business limit: none has been agreed.
 */
export const CAPACITY_COLUMN_MAX = 2_147_483_647;

/** SCRUM-116 AC3: a positive whole number. Rejects "abc", 150.5, 0 and -1. */
const MaxCapacitySchema = z
  .number({
    required_error: 'Maximum capacity is required.',
    invalid_type_error: 'Maximum capacity must be a whole number.',
  })
  .int('Maximum capacity must be a whole number.')
  .positive('Maximum capacity must be greater than 0.')
  .max(CAPACITY_COLUMN_MAX, 'Maximum capacity is too large.');

const LayoutCapacitySchema = z
  .number({
    required_error: 'Layout capacity is required.',
    invalid_type_error: 'Layout capacity must be a whole number.',
  })
  .int('Layout capacity must be a whole number.')
  .positive('Layout capacity must be greater than 0.')
  .max(CAPACITY_COLUMN_MAX, 'Layout capacity is too large.');

const VenueNameSchema = z
  .string({ required_error: 'Venue name is required.' })
  .trim()
  .min(1, 'Venue name is required.')
  .max(VENUE_NAME_MAX_LENGTH, `Venue name must be ${VENUE_NAME_MAX_LENGTH} characters or fewer.`);

/** SCRUM-116 AC4: at least one slot, no repeats. */
const OperatingSlotsSchema = z
  .array(OperatingSlotSchema)
  .min(1, 'Select at least one operating slot.')
  .refine((slots) => new Set(slots).size === slots.length, 'Each operating slot can only be selected once.');

const IdListSchema = (label: string) =>
  z
    .array(z.string().uuid(`Each ${label} must be a valid id.`))
    .refine((ids) => new Set(ids).size === ids.length, `Each ${label} can only be selected once.`);

/** SCRUM-118 AC1: a supported layout with its own capacity. */
export const VenueLayoutInputSchema = z.object({
  layout: RoomLayoutSchema,
  capacity: LayoutCapacitySchema,
});
export type VenueLayoutInput = z.infer<typeof VenueLayoutInputSchema>;

const LayoutListSchema = z
  .array(VenueLayoutInputSchema)
  .refine(
    (layouts) => new Set(layouts.map((l) => l.layout)).size === layouts.length,
    'Each layout can only be added once per venue.',
  );

/** SCRUM-225 AC1: setup and turnaround are whole minutes on the 15-minute booking unit. */
export const SETUP_TURNAROUND_STEP_MINUTES = 15;

/**
 * SCRUM-225 AC1 and AC2: a setup or turnaround time in whole minutes, in
 * 15-minute steps. 0 is allowed: it is what every venue has until one is set
 * (AC3). AC2 refuses a negative value or one that is not a multiple of 15, and
 * "the field is identified", so each field gets one message of its own rather
 * than several for one typo.
 *
 * No upper limit has been agreed; CAPACITY_COLUMN_MAX is only the integer
 * column's limit, so a huge number is refused here rather than failing in
 * Postgres with an error the form cannot pin on the field.
 */
function setupTurnaroundMinutesSchema(label: 'Setup time' | 'Turnaround time') {
  const wholeMinutes = `${label} must be a whole number of minutes.`;
  return z.number({ invalid_type_error: wholeMinutes }).superRefine((minutes, ctx) => {
    const message = !Number.isInteger(minutes)
      ? wholeMinutes
      : minutes < 0
        ? `${label} cannot be negative.`
        : minutes % SETUP_TURNAROUND_STEP_MINUTES !== 0
          ? `${label} must be in 15-minute steps (0, 15, 30, 45 and so on).`
          : minutes > CAPACITY_COLUMN_MAX
            ? `${label} is too large.`
            : null;
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}

/**
 * SCRUM-239 AC1: "when I set opening and closing times in 15-minute steps and
 * save, then they replace the venue's slot configuration". Each time on its
 * 15-minute step (the shared StartTimeSchema / EndTimeSchema), sent together,
 * and the closing time after the opening time. Errors are on opensAt /
 * closesAt so the form can name the field.
 */
const OpensAtSchema = StartTimeSchema;
const ClosesAtSchema = EndTimeSchema;

function hoursTogether(input: { opensAt?: string; closesAt?: string }, ctx: z.RefinementCtx) {
  const { opensAt, closesAt } = input;
  if (opensAt === undefined && closesAt === undefined) return;
  if (opensAt === undefined || closesAt === undefined) {
    const path = opensAt === undefined ? 'opensAt' : 'closesAt';
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: 'Set both the opening and the closing time.' });
    return;
  }
  // The shared rule: closing after opening, on both fields.
  const range = ClockRangeSchema.safeParse({ start: opensAt, end: closesAt });
  if (range.success) return;
  for (const issue of range.error.issues) {
    if (issue.message === 'The end time must be after the start time.') {
      const field = issue.path[0] === 'start' ? 'opensAt' : 'closesAt';
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: 'The closing time must be after the opening time.' });
    }
  }
}

// -----------------------------------------------------------------------------
// Inputs (request bodies and query strings)
// -----------------------------------------------------------------------------

/**
 * SCRUM-116 + SCRUM-117 + SCRUM-118: create a venue.
 *
 * Operating slots default to all three when omitted, so a venue created with
 * only a name, location and capacity (US-11.1-TC01) is still valid.
 *
 * The setup/turnaround slot flags (SCRUM-119, accepted on update only —
 * see UpdateVenueInputSchema) and retiring (SCRUM-122) are deliberately
 * not accepted here.
 */
export const CreateVenueInputSchema = z
  .object({
    name: VenueNameSchema,
    locationId: z.string({ required_error: 'Location is required.' }).uuid('Location must be chosen from the list.'),
    maxCapacity: MaxCapacitySchema,
    operatingSlots: OperatingSlotsSchema.default([...OPERATING_SLOTS]),
    facilityIds: IdListSchema('facility').default([]),
    accessibilityFeatureIds: IdListSchema('accessibility feature').default([]),
    layouts: LayoutListSchema.default([]),
    /**
     * SCRUM-239 AC1: the venue's opening hours. Left out (an older caller),
     * they are filled from the operating slots, as before.
     */
    opensAt: OpensAtSchema.optional(),
    closesAt: ClosesAtSchema.optional(),
  })
  .superRefine(hoursTogether);
/** Shape after parsing (defaults filled in). */
export type CreateVenueInput = z.infer<typeof CreateVenueInputSchema>;
/** Shape a form may send (defaulted fields optional). */
export type CreateVenueRequest = z.input<typeof CreateVenueInputSchema>;

/**
 * SCRUM-120 (+ SCRUM-117 AC3, SCRUM-118): update a venue.
 *
 * Written out field by field instead of CreateVenueInputSchema.partial():
 * .partial() keeps the defaults, so leaving out facilityIds would wipe the
 * venue's facilities. Here, a field that is left out is left unchanged, and a
 * list that is sent replaces the whole list (so removing Whiteboard means
 * sending the list without it).
 *
 * expectedUpdatedAt is the venue's updatedAt when the editor's form was
 * loaded. The save only goes ahead while the venue still has it, so an edit
 * from a form that has gone out of date is refused (409) instead of silently
 * undoing the save made in between. Found reviewing SCRUM-215, the same kind
 * of bug.
 */
/** Fields that steer a save rather than change the venue, so they alone are "Nothing to update". */
const UPDATE_CONTROL_FIELDS: readonly string[] = [
  'expectedUpdatedAt',
  'confirmAffectedBookings',
  'confirmSetupTurnaroundChange',
];

export const UpdateVenueInputSchema = z
  .object({
    expectedUpdatedAt: z
      .string({
        required_error: 'expectedUpdatedAt is required: send the updatedAt of the venue you are editing.',
      })
      .datetime({ offset: true, message: 'expectedUpdatedAt must be the updatedAt the venue was loaded with.' }),
    name: VenueNameSchema.optional(),
    locationId: z.string().uuid('Location must be chosen from the list.').optional(),
    maxCapacity: MaxCapacitySchema.optional(),
    operatingSlots: OperatingSlotsSchema.optional(),
    facilityIds: IdListSchema('facility').optional(),
    accessibilityFeatureIds: IdListSchema('accessibility feature').optional(),
    layouts: LayoutListSchema.optional(),
    /**
     * SCRUM-119 (revised): whether the venue needs a setup slot before an
     * event and a turnaround slot after it. SCRUM-148 applies the actual
     * adjacent-slot-blocking rule using these flags; this schema only
     * carries them.
     *
     * Replaced in the app by setupMinutes and turnaroundMinutes (SCRUM-225),
     * which the venue form edits instead. Still accepted, and still stored,
     * until the slot columns are dropped with the rest of the slot model
     * (20261008140500_time_model.sql); SCRUM-119 stays Done.
     */
    needsSetupSlot: z.boolean().optional(),
    needsTurnaroundSlot: z.boolean().optional(),
    /** SCRUM-225 AC1: minutes the venue needs before an event to set up. */
    setupMinutes: setupTurnaroundMinutesSchema('Setup time').optional(),
    /** SCRUM-225 AC1: minutes the venue needs after an event to reset. */
    turnaroundMinutes: setupTurnaroundMinutesSchema('Turnaround time').optional(),
    /**
     * SCRUM-239 AC1: the venue's opening and closing times, which replace its
     * operating slots (operatingSlots above is still accepted from older
     * callers, and still stored, but nothing reads it for availability).
     */
    opensAt: OpensAtSchema.optional(),
    closesAt: ClosesAtSchema.optional(),
    /**
     * SCRUM-120 AC2: the user has seen the confirmed future bookings a capacity
     * cut affects and confirmed it. Without it, such a cut is refused with the
     * list of those bookings (AffectedBookingsDetails).
     */
    confirmAffectedBookings: z.boolean().optional(),
    /**
     * SCRUM-225 AC4: the user has seen the confirmed bookings a setup or
     * turnaround change makes clash and confirmed it. Without it, such a change
     * is refused with the list of those bookings (SetupTurnaroundClashesDetails).
     */
    confirmSetupTurnaroundChange: z.boolean().optional(),
  })
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => !UPDATE_CONTROL_FIELDS.includes(key) && value !== undefined,
      ),
    'Nothing to update.',
  )
  .superRefine(hoursTogether);
export type UpdateVenueInput = z.infer<typeof UpdateVenueInputSchema>;

/**
 * SCRUM-121 AC3: the default view hides retired venues.
 * Query strings arrive as text, so "true" is the only value that includes them.
 */
export const VenueListQuerySchema = z.object({
  includeRetired: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type VenueListQuery = z.infer<typeof VenueListQuerySchema>;

/**
 * SCRUM-239 AC2: search by a date and an exact start and end time, on the
 * 15-minute unit, replacing SCRUM-128's slots. The times are checked by the
 * shared ClockRangeSchema, so an off-step time or an end not after the start
 * is refused the same way as everywhere else.
 *
 * SCRUM-128 AC5 still holds: no booking horizon applies (customer
 * clarification #57), so the date has no upper limit, and it isn't held to the
 * future, since a search commits nothing.
 */
export const VenueSearchQuerySchema = z
  .object({
    date: z
      .string({ required_error: 'Enter a date.' })
      .refine(isISODate, 'Enter a real date as YYYY-MM-DD.'),
  })
  .and(ClockRangeSchema);
export type VenueSearchQuery = z.infer<typeof VenueSearchQuerySchema>;

// -----------------------------------------------------------------------------
// SCRUM-130 Filter by capacity, layout, accessibility, facilities and location
// -----------------------------------------------------------------------------

/**
 * The filters narrow SCRUM-239's search; the date and the start and end time
 * stay required (VenueSearchQuerySchema). Every filter is optional, and every
 * filter set must hold (they combine with AND). They arrive as query string
 * text, so a blank value means the filter is not set.
 */
export const MIN_CAPACITY_MESSAGE = 'Minimum capacity must be a whole number greater than 0.';
export const CHOOSE_LAYOUT_MESSAGE = 'Choose a layout from the list.';

/** With filters set and nothing found (TC-130-26); without any, SCRUM-239's message stays (TC-130-27). */
export const NO_VENUE_MATCHES_FILTERS_MESSAGE = 'No venue matches your filters for that period';

/** Query string text: '' (an empty field) is "not set". */
const blankToUndefined = (value: unknown) => (value === '' || value === null ? undefined : value);

/** A repeated query parameter arrives as one string or several: always a list. */
const toList = (value: unknown) => {
  const blank = blankToUndefined(value);
  if (blank === undefined) return [];
  return (Array.isArray(blank) ? blank : [blank]).filter((item) => item !== '');
};

/**
 * AC1, AC2: the same rule as a venue's capacity (MaxCapacitySchema): a whole
 * number greater than 0. Text that is a number is read as one; anything else
 * ("abc") is refused with the same message (TC-130-05: 0, -5, abc, 10.5).
 */
const MinCapacitySchema = z.preprocess(
  (value) => {
    const blank = blankToUndefined(value);
    if (typeof blank !== 'string') return blank;
    const text = blank.trim();
    if (text === '') return undefined;
    return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
  },
  z
    .number({ invalid_type_error: MIN_CAPACITY_MESSAGE })
    .int(MIN_CAPACITY_MESSAGE)
    .positive(MIN_CAPACITY_MESSAGE)
    .max(CAPACITY_COLUMN_MAX, 'Minimum capacity is too large.')
    .optional(),
);

export const VenueSearchFiltersSchema = z.object({
  /** AC1 (no layout): the venue's maximum capacity; AC2 (with a layout): that layout's capacity. */
  minCapacity: MinCapacitySchema,
  /** AC3: venues recording support for this layout. */
  layout: z.preprocess(
    blankToUndefined,
    z.enum(ROOM_LAYOUTS, { errorMap: () => ({ message: CHOOSE_LAYOUT_MESSAGE }) }).optional(),
  ),
  /** AC5: one location from the maintained list; AC6: unset means every location. */
  locationId: z.preprocess(blankToUndefined, z.string().uuid('Location must be chosen from the list.').optional()),
  /** AC4: venues providing all of these facilities. */
  facilityIds: z.preprocess(toList, IdListSchema('facility')),
  /** AC7: venues recording all of these accessibility features. */
  accessibilityFeatureIds: z.preprocess(toList, IdListSchema('accessibility feature')),
});
export type VenueSearchFilters = z.infer<typeof VenueSearchFiltersSchema>;

/**
 * SCRUM-123: the longest range one calendar view shows. The card sets no
 * limit; 31 days (a month) is the team's choice (6 Oct 2026), so a single
 * request can't ask for years of slots.
 */
export const CALENDAR_MAX_DAYS = 31;

/** Days from `from` to `to`, counting both ends: 2026-12-01 to 2026-12-01 is 1. */
export function daysInRange(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * SCRUM-123 AC1: "Given I open a venue's calendar for a date range".
 * A range that ends before it starts isn't one, and one view shows at most
 * CALENDAR_MAX_DAYS days.
 */
export const VenueCalendarQuerySchema = z
  .object({
    from: z.string({ required_error: 'Enter a start date.' }).refine(isISODate, 'Enter a real start date as YYYY-MM-DD.'),
    to: z.string({ required_error: 'Enter an end date.' }).refine(isISODate, 'Enter a real end date as YYYY-MM-DD.'),
  })
  .superRefine(({ from, to }, ctx) => {
    if (!isISODate(from) || !isISODate(to)) return;
    if (to < from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'The end date cannot be before the start date.' });
    } else if (daysInRange(from, to) > CALENDAR_MAX_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: `A calendar can show at most ${CALENDAR_MAX_DAYS} days.`,
      });
    }
  });
export type VenueCalendarQuery = z.infer<typeof VenueCalendarQuerySchema>;

// -----------------------------------------------------------------------------
// Outputs (what the API returns)
// -----------------------------------------------------------------------------

/** One entry in a maintained list: a location, facility or accessibility feature. */
export const ReferenceItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type ReferenceItem = z.infer<typeof ReferenceItemSchema>;

/** Everything the add and edit venue forms need to fill their dropdowns. */
export const VenueFormOptionsSchema = z.object({
  locations: z.array(ReferenceItemSchema),
  facilities: z.array(ReferenceItemSchema),
  accessibilityFeatures: z.array(ReferenceItemSchema),
  operatingSlots: z.array(OperatingSlotSchema),
  layouts: z.array(RoomLayoutSchema),
});
export type VenueFormOptions = z.infer<typeof VenueFormOptionsSchema>;

/** SCRUM-121 AC1: one row in the catalogue list. */
export const VenueSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  location: ReferenceItemSchema,
  maxCapacity: z.number().int(),
  isRetired: z.boolean(),
});
export type VenueSummary = z.infer<typeof VenueSummarySchema>;

/**
 * SCRUM-239 AC2: the venues free for the whole searched period, echoed with what was searched.
 *
 * SCRUM-130: only those matching every filter set. `filtered` says whether any
 * filter was set, so the page knows which message an empty result gets, and
 * `layoutCapacity` is the chosen layout's capacity (null without a layout).
 */
export const VenueSearchResultSchema = z.object({
  date: z.string(),
  start: z.string(),
  end: z.string(),
  filtered: z.boolean(),
  venues: z.array(VenueSummarySchema.extend({ layoutCapacity: z.number().int().nullable() })),
});
export type VenueSearchResult = z.infer<typeof VenueSearchResultSchema>;

/**
 * SCRUM-239 AC5: what a period on the calendar is. Replaces SCRUM-123's
 * per-slot states (which stays Done on slots, per the Week 7 guide):
 * - confirmed: a confirmed booking (SCRUM-123 AC5)
 * - pending: a pending booking request line; not a commitment (SCRUM-123 AC6, AC8)
 * - held: an active hold, with its expiry (SCRUM-227 AC7)
 * - blocked: a period Venue Staff marked unavailable, with its reason (SCRUM-123 AC7)
 */
export const CALENDAR_PERIOD_KINDS = ['confirmed', 'pending', 'held', 'blocked'] as const;
export const CalendarPeriodKindSchema = z.enum(CALENDAR_PERIOD_KINDS);
export type CalendarPeriodKind = z.infer<typeof CalendarPeriodKindSchema>;

/** The words each kind of period is shown with. */
export const CALENDAR_PERIOD_LABELS: Record<CalendarPeriodKind, string> = {
  confirmed: 'Confirmed',
  pending: 'Pending request',
  held: 'Held',
  blocked: 'Blocked',
};

/**
 * One period on one date, with its exact start and end time (SCRUM-239 AC5).
 *
 * Event details follow SCRUM-148 AC3/AC4, decided by its listVenueBookings():
 * Venue Staff, the event's assigned coordinator and Event Operations Managers
 * see which event holds a Confirmed period; anyone else sees only that it is
 * Confirmed. Client and coordinator details are never shown (customer
 * clarification #91).
 */
export const CalendarPeriodSchema = z.object({
  kind: CalendarPeriodKindSchema,
  start: z.string(),
  end: z.string(),
  /** SCRUM-123 AC7: the recorded reason, only for a Blocked period. */
  reason: z.string().nullable(),
  /** SCRUM-148 AC3: the event on a Confirmed period, when the viewer may see it. */
  event: z.object({ id: z.string().uuid(), reference: z.string(), name: z.string() }).nullable(),
  /** SCRUM-227 AC7: when the hold expires (an ISO instant), only for a Held period. */
  expiresAt: z.string().nullable().optional(),
});
export type CalendarPeriod = z.infer<typeof CalendarPeriodSchema>;

export const CalendarDaySchema = z.object({
  date: z.string(),
  /** SCRUM-123 AC4: committed periods cover the venue's whole opening hours that day. */
  fullyCommitted: z.boolean(),
  /** In start-time order; a day with none is available all through its opening hours. */
  periods: z.array(CalendarPeriodSchema),
});
export type CalendarDay = z.infer<typeof CalendarDaySchema>;

export const VenueCalendarSchema = z.object({
  /** SCRUM-123 AC3: outside these hours the venue cannot be requested. */
  venue: z.object({ id: z.string().uuid(), name: z.string(), opensAt: z.string(), closesAt: z.string() }),
  from: z.string(),
  to: z.string(),
  days: z.array(CalendarDaySchema),
});
export type VenueCalendar = z.infer<typeof VenueCalendarSchema>;

export const VenueLayoutSchema = z.object({
  layout: RoomLayoutSchema,
  capacity: z.number().int(),
});
export type VenueLayout = z.infer<typeof VenueLayoutSchema>;

/** SCRUM-121 AC2: the full venue page. */
export const VenueDetailSchema = VenueSummarySchema.extend({
  operatingSlots: z.array(OperatingSlotSchema),
  /** SCRUM-239 AC1: the venue's opening hours (HH:MM), which replace its slots. */
  opensAt: z.string(),
  closesAt: z.string(),
  facilities: z.array(ReferenceItemSchema),
  accessibilityFeatures: z.array(ReferenceItemSchema),
  layouts: z.array(VenueLayoutSchema),
  needsSetupSlot: z.boolean(),
  needsTurnaroundSlot: z.boolean(),
  /** SCRUM-225 AC1 and AC3: 0 until Venue Staff set them. */
  setupMinutes: z.number().int().min(0),
  turnaroundMinutes: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VenueDetail = z.infer<typeof VenueDetailSchema>;

/**
 * SCRUM-120 AC2: a confirmed future booking that a capacity cut would affect.
 * Sent back with the 409 that asks the editor to confirm, so the form can show
 * which events they are about to put over capacity, and who coordinates each.
 */
export const AffectedBookingSchema = z.object({
  eventId: z.string().uuid(),
  reference: z.string(),
  eventName: z.string(),
  proposedDate: z.string(),
  expectedAttendance: z.number().int(),
  coordinatorId: z.string().uuid().nullable(),
});

export type AffectedBooking = z.infer<typeof AffectedBookingSchema>;

/** The details of that 409. `reason` tells it apart from the other venue 409s. */
export const AffectedBookingsDetailsSchema = z.object({
  reason: z.literal('affected_bookings'),
  maxCapacity: z.number().int(),
  bookings: z.array(AffectedBookingSchema),
});
export type AffectedBookingsDetails = z.infer<typeof AffectedBookingsDetailsSchema>;

/**
 * SCRUM-225 AC4: a confirmed booking that a setup or turnaround change would
 * make clash with another. Venue Staff make the change and may see which event
 * holds each booking (SCRUM-155 AC1, SCRUM-148 AC3).
 */
export const SetupTurnaroundClashBookingSchema = z.object({
  bookingId: z.string().uuid(),
  eventId: z.string().uuid(),
  reference: z.string(),
  eventName: z.string(),
  date: z.string(),
  start: z.string(),
  end: z.string(),
});
export type SetupTurnaroundClashBooking = z.infer<typeof SetupTurnaroundClashBookingSchema>;

/** SCRUM-225 AC4: the details of the 409 that asks the editor to confirm the change. */
export const SetupTurnaroundClashesDetailsSchema = z.object({
  reason: z.literal('setup_turnaround_clashes'),
  setupMinutes: z.number().int(),
  turnaroundMinutes: z.number().int(),
  bookings: z.array(SetupTurnaroundClashBookingSchema),
});
export type SetupTurnaroundClashesDetails = z.infer<typeof SetupTurnaroundClashesDetailsSchema>;

/**
 * SCRUM-225 AC5: a confirmed booking flagged as affected by a confirmed setup
 * or turnaround change, with the values that change set and when.
 */
export const SetupTurnaroundAffectedBookingSchema = SetupTurnaroundClashBookingSchema.extend({
  setupMinutes: z.number().int(),
  turnaroundMinutes: z.number().int(),
  flaggedAt: z.string(),
});
export type SetupTurnaroundAffectedBooking = z.infer<typeof SetupTurnaroundAffectedBookingSchema>;
