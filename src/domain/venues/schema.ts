import { z } from 'zod';
import { isISODate } from '@/domain/shared/dates';
import { ClockRangeSchema } from '@/domain/shared/times';

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
export const CreateVenueInputSchema = z.object({
  name: VenueNameSchema,
  locationId: z.string({ required_error: 'Location is required.' }).uuid('Location must be chosen from the list.'),
  maxCapacity: MaxCapacitySchema,
  operatingSlots: OperatingSlotsSchema.default([...OPERATING_SLOTS]),
  facilityIds: IdListSchema('facility').default([]),
  accessibilityFeatureIds: IdListSchema('accessibility feature').default([]),
  layouts: LayoutListSchema.default([]),
});
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
     */
    needsSetupSlot: z.boolean().optional(),
    needsTurnaroundSlot: z.boolean().optional(),
    /**
     * SCRUM-120 AC2: the user has seen the confirmed future bookings a capacity
     * cut affects and confirmed it. Without it, such a cut is refused with the
     * list of those bookings (AffectedBookingsDetails).
     */
    confirmAffectedBookings: z.boolean().optional(),
  })
  .refine(
    (input) =>
      Object.entries(input).some(
        ([key, value]) => key !== 'confirmAffectedBookings' && key !== 'expectedUpdatedAt' && value !== undefined,
      ),
    'Nothing to update.',
  );
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

/** SCRUM-239 AC2: the venues free for the whole searched period, echoed with what was searched. */
export const VenueSearchResultSchema = z.object({
  date: z.string(),
  start: z.string(),
  end: z.string(),
  venues: z.array(VenueSummarySchema),
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
  facilities: z.array(ReferenceItemSchema),
  accessibilityFeatures: z.array(ReferenceItemSchema),
  layouts: z.array(VenueLayoutSchema),
  needsSetupSlot: z.boolean(),
  needsTurnaroundSlot: z.boolean(),
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
