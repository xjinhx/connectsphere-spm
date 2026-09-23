import { z } from 'zod';

/**
 * Venue Catalogue (EP-08): data shapes shared by the API routes and the UI.
 *
 * SCRUM-116 Add a venue to the catalogue
 * SCRUM-117 Record facilities and accessibility features
 * SCRUM-118 Record supported room layouts and their capacities
 * SCRUM-120 Update venue information
 * SCRUM-121 Browse and view the venue catalogue
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
 * Turnaround values (SCRUM-119) and retiring (SCRUM-122) are deliberately not
 * accepted here: those stories are not in Sprint 1.
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
 */
export const UpdateVenueInputSchema = z
  .object({
    name: VenueNameSchema.optional(),
    locationId: z.string().uuid('Location must be chosen from the list.').optional(),
    maxCapacity: MaxCapacitySchema.optional(),
    operatingSlots: OperatingSlotsSchema.optional(),
    facilityIds: IdListSchema('facility').optional(),
    accessibilityFeatureIds: IdListSchema('accessibility feature').optional(),
    layouts: LayoutListSchema.optional(),
    /**
     * SCRUM-120 AC2: the user has seen the future bookings a capacity cut
     * affects and confirmed. Blocked until confirmed bookings (SCRUM-148) exist.
     */
    confirmAffectedBookings: z.boolean().optional(),
  })
  .refine(
    (input) => Object.entries(input).some(([key, value]) => key !== 'confirmAffectedBookings' && value !== undefined),
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
  setupMinutes: z.number().int().nullable(),
  teardownMinutes: z.number().int().nullable(),
  turnaroundMinutes: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VenueDetail = z.infer<typeof VenueDetailSchema>;
