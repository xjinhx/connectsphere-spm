import {
  createVenueWithLists,
  fetchAccessibilityFeatureIdsIn,
  fetchAccessibilityFeatures,
  fetchFacilities,
  fetchFacilityIdsIn,
  fetchLocationById,
  fetchLocations,
  fetchVenueDetail,
  fetchVenueSummaries,
  saveVenueChanges,
} from '@/lib/supabase/venues';
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from '@/domain/shared/errors';
import { assertLayoutsWithinMaxCapacity } from './policy';
import {
  CreateVenueInputSchema,
  OPERATING_SLOTS,
  ROOM_LAYOUTS,
  UpdateVenueInputSchema,
  VenueDetailSchema,
  VenueFormOptionsSchema,
  VenueIdSchema,
  VenueSummarySchema,
  type VenueDetail,
  type VenueFormOptions,
  type VenueLayoutInput,
  type VenueSummary,
} from './schema';

/**
 * Venue Catalogue service (EP-08).
 *
 * SCRUM-116 Add a venue          SCRUM-120 Update venue information
 * SCRUM-117 Facilities/access    SCRUM-121 Browse and view the catalogue
 * SCRUM-118 Room layouts
 *
 * Orchestration only. Every query lives in src/lib/supabase/venues.ts, every
 * rule that compares two values lives in policy.ts, and every single-field
 * rule lives in schema.ts. This file validates input, calls those, and turns
 * Supabase errors into domain errors.
 *
 * Rows are mapped and then parsed back through the output schemas, so what
 * leaves this file is guaranteed to match the contract the API and UI expect
 * rather than being asserted into shape with a cast.
 */

// -----------------------------------------------------------------------------
// Row shapes returned by the nested selects in lib/supabase/venues.ts
// -----------------------------------------------------------------------------

type ReferenceRow = { id: string; name: string };

/** Postgres guarantees location_id is present; the generated types cannot. */
function requireLocation(location: ReferenceRow | null, venueName: string): ReferenceRow {
  if (!location) {
    throw new ValidationError('Venue is missing its location.', { venue: venueName });
  }
  return location;
}

// -----------------------------------------------------------------------------
// Reading (SCRUM-121)
// -----------------------------------------------------------------------------

/** SCRUM-121 AC1 and AC3: the catalogue list, retired venues hidden by default. */
export async function listVenues(includeRetired = false): Promise<VenueSummary[]> {
  const { data, error } = await fetchVenueSummaries(includeRetired);

  if (error || !data) {
    throw new ValidationError('Could not load the venue catalogue.', error?.message);
  }

  return data.map((row) =>
    VenueSummarySchema.parse({
      id: row.id,
      name: row.name,
      location: requireLocation(row.locations, row.name),
      maxCapacity: row.max_capacity,
      isRetired: row.is_retired,
    }),
  );
}

/**
 * SCRUM-121 AC2: the full venue page, including the turnaround values.
 *
 * A malformed id is a venue that does not exist, not a database error: without
 * this check Postgres rejects it (22P02) and the venue pages answered 500 for
 * a mistyped link instead of showing not-found.
 */
export async function getVenue(venueId: string): Promise<VenueDetail> {
  if (!VenueIdSchema.safeParse(venueId).success) {
    throw new NotFoundError('Venue');
  }

  const { data, error } = await fetchVenueDetail(venueId);

  if (error) {
    throw new ValidationError('Could not load the venue.', error.message);
  }
  if (!data) {
    throw new NotFoundError('Venue');
  }

  return VenueDetailSchema.parse({
    id: data.id,
    name: data.name,
    location: requireLocation(data.locations, data.name),
    maxCapacity: data.max_capacity,
    isRetired: data.is_retired,
    operatingSlots: data.operating_slots,
    facilities: data.venue_facilities.flatMap((link) => (link.facilities ? [link.facilities] : [])),
    accessibilityFeatures: data.venue_accessibility_features.flatMap((link) =>
      link.accessibility_features ? [link.accessibility_features] : [],
    ),
    layouts: data.venue_layouts.map((row) => ({ layout: row.layout, capacity: row.capacity })),
    setupMinutes: data.setup_minutes,
    teardownMinutes: data.teardown_minutes,
    turnaroundMinutes: data.turnaround_minutes,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

/** Everything the add and edit forms need for their dropdowns (SCRUM-116, 117). */
export async function getVenueFormOptions(): Promise<VenueFormOptions> {
  const [locations, facilities, accessibilityFeatures] = await Promise.all([
    fetchLocations(),
    fetchFacilities(),
    fetchAccessibilityFeatures(),
  ]);

  const firstError = locations.error ?? facilities.error ?? accessibilityFeatures.error;
  if (firstError) {
    throw new ValidationError('Could not load the venue form options.', firstError.message);
  }

  return VenueFormOptionsSchema.parse({
    locations: locations.data ?? [],
    facilities: facilities.data ?? [],
    accessibilityFeatures: accessibilityFeatures.data ?? [],
    operatingSlots: [...OPERATING_SLOTS],
    layouts: [...ROOM_LAYOUTS],
  });
}

// -----------------------------------------------------------------------------
// Checking that chosen ids are really on the maintained lists
// -----------------------------------------------------------------------------

async function assertLocationExists(locationId: string) {
  const { data, error } = await fetchLocationById(locationId);
  if (error) {
    throw new ValidationError('Could not check the location.', error.message);
  }
  if (!data) {
    throw new ValidationError('Location must be chosen from the list.', { locationId });
  }
}

async function assertFacilitiesExist(facilityIds: string[]): Promise<void> {
  if (facilityIds.length === 0) return;
  const { data, error } = await fetchFacilityIdsIn(facilityIds);
  if (error) {
    throw new ValidationError('Could not check the facilities.', error.message);
  }
  const found = new Set((data ?? []).map((row) => row.id));
  const missing = facilityIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ValidationError('Each facility must be chosen from the list.', { missing });
  }
}

async function assertAccessibilityFeaturesExist(featureIds: string[]): Promise<void> {
  if (featureIds.length === 0) return;
  const { data, error } = await fetchAccessibilityFeatureIdsIn(featureIds);
  if (error) {
    throw new ValidationError('Could not check the accessibility features.', error.message);
  }
  const found = new Set((data ?? []).map((row) => row.id));
  const missing = featureIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new ValidationError('Each accessibility feature must be chosen from the list.', { missing });
  }
}

// -----------------------------------------------------------------------------
// Creating (SCRUM-116, SCRUM-117, SCRUM-118)
// -----------------------------------------------------------------------------

/**
 * SCRUM-116 AC1 to AC4, SCRUM-117 AC1 and AC2, SCRUM-118 AC1.
 *
 * The venue and its lists are written by one database function, in one
 * transaction, so a failure part-way leaves nothing behind. This used to be
 * separate inserts undone by a compensating delete whose own failure went
 * unnoticed (found reviewing SCRUM-215).
 */
export async function createVenue(input: unknown): Promise<VenueDetail> {
  const parsed = CreateVenueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The venue could not be saved.', parsed.error.flatten());
  }
  const venue = parsed.data;

  // SCRUM-118 AC3 and AC4: check before writing anything.
  assertLayoutsWithinMaxCapacity(venue.maxCapacity, venue.layouts);

  await assertLocationExists(venue.locationId);
  await assertFacilitiesExist(venue.facilityIds);
  await assertAccessibilityFeaturesExist(venue.accessibilityFeatureIds);

  const { data: createdId, error } = await createVenueWithLists({
    name: venue.name,
    locationId: venue.locationId,
    maxCapacity: venue.maxCapacity,
    operatingSlots: [...venue.operatingSlots],
    facilityIds: venue.facilityIds,
    accessibilityFeatureIds: venue.accessibilityFeatureIds,
    layouts: venue.layouts,
  });

  // SCRUM-116 AC2: the unique index on lower(name) is what actually enforces this.
  if (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Venue name is already in use.', { name: venue.name });
    }
    throw new ValidationError('The venue could not be saved.', error.message);
  }
  if (!createdId) {
    throw new ValidationError('The venue could not be saved.');
  }

  return getVenue(createdId);
}

// -----------------------------------------------------------------------------
// Updating (SCRUM-120, SCRUM-117 AC3, SCRUM-118)
// -----------------------------------------------------------------------------

/**
 * The answer for an editor whose form is older than the venue. It does not
 * say who changed it: a save of their own that went through but whose reply
 * never arrived looks exactly the same, and retrying it lands here.
 */
function venueChangedError(): ConflictError {
  return new ConflictError(
    'This venue has changed since you opened this form. Reload the page to see the latest version before changing it again.',
    { reason: 'venue_changed' },
  );
}

/**
 * SCRUM-120 AC1, SCRUM-117 AC3, SCRUM-118.
 *
 * A field that was left out is left alone. A list that was sent replaces the
 * whole list, so removing a facility means sending the list without it.
 *
 * Found reviewing SCRUM-215, the same kind of bug: a save was several separate
 * writes, so a failure part-way left the venue half-saved, and nothing checked
 * that the editor's form was still current, so a save from an older form
 * silently undid the one made in between. Now the caller sends the updatedAt
 * the form was loaded with, and one database function checks it under a lock
 * and writes everything in one transaction. That also keeps the SCRUM-118
 * check below true when the save lands: nothing can have changed since the
 * venue it checked was read.
 *
 * SCRUM-120 AC2, AC3 and AC4 are not implemented: they are written against a
 * confirmed future booking, and bookings are SCRUM-148, which is not in
 * Sprint 1. See findAffectedFutureBookings below.
 */
export async function updateVenue(venueId: string, input: unknown): Promise<VenueDetail> {
  const parsed = UpdateVenueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The venue could not be updated.', parsed.error.flatten());
  }
  const { expectedUpdatedAt, ...changes } = parsed.data;

  // Throws NotFoundError if the venue is not there.
  const current = await getVenue(venueId);

  // Already out of date: say so now, rather than judging the edit against
  // values the editor never saw. Compared to the millisecond, so two versions
  // within one millisecond get past this; the database function compares the
  // exact value and refuses those.
  if (Date.parse(current.updatedAt) !== Date.parse(expectedUpdatedAt)) {
    throw venueChangedError();
  }

  // SCRUM-118 AC3 and AC4 against the values the venue will hold AFTER the
  // update, so lowering the maximum under an existing layout is refused too.
  const finalMaxCapacity = changes.maxCapacity ?? current.maxCapacity;
  const finalLayouts: VenueLayoutInput[] = changes.layouts ?? current.layouts;
  assertLayoutsWithinMaxCapacity(finalMaxCapacity, finalLayouts);

  if (changes.locationId !== undefined) {
    await assertLocationExists(changes.locationId);
  }
  if (changes.facilityIds !== undefined) {
    await assertFacilitiesExist(changes.facilityIds);
  }
  if (changes.accessibilityFeatureIds !== undefined) {
    await assertAccessibilityFeaturesExist(changes.accessibilityFeatureIds);
  }

  const { data: outcome, error } = await saveVenueChanges(current.id, expectedUpdatedAt, {
    name: changes.name,
    locationId: changes.locationId,
    maxCapacity: changes.maxCapacity,
    operatingSlots: changes.operatingSlots === undefined ? undefined : [...changes.operatingSlots],
    facilityIds: changes.facilityIds,
    accessibilityFeatureIds: changes.accessibilityFeatureIds,
    layouts: changes.layouts,
  });

  if (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('Venue name is already in use.', { name: changes.name });
    }
    throw new ValidationError('The venue could not be updated.', error.message);
  }
  if (outcome === 'stale') {
    throw venueChangedError();
  }
  if (outcome === 'not_found') {
    throw new NotFoundError('Venue');
  }
  if (outcome !== 'updated') {
    throw new ValidationError('The venue could not be updated.');
  }

  return getVenue(current.id);
}

// -----------------------------------------------------------------------------
// Blocked: SCRUM-120 AC2, AC3 and AC4
// -----------------------------------------------------------------------------

/** A confirmed future booking that a capacity reduction would affect. */
export type AffectedBooking = {
  eventId: string;
  eventName: string;
  expectedAttendance: number;
  coordinatorId: string | null;
};

/**
 * SCRUM-120 AC2: a capacity cut below a confirmed booking must list the
 * affected bookings and be confirmed before it is applied.
 *
 * DUMMY(SCRUM-148) D-04: there is no bookings table in Sprint 1, so nothing can be
 * affected yet and this always returns an empty list. When bookings land, this
 * takes the venue id and the proposed maximum capacity, and updateVenue must
 * refuse unless UpdateVenueInput.confirmAffectedBookings is true.
 *
 * DUMMY(SCRUM-24) D-05: SCRUM-120 AC4 then notifies the coordinator assigned to each
 * affected event. No notification system exists in Sprint 1.
 *
 * Until both land, SCRUM-120 AC2, AC3 and AC4 stay unverifiable and the ticket
 * belongs in Merged - Pending Verification, not Done.
 */
export async function findAffectedFutureBookings(): Promise<AffectedBooking[]> {
  return [];
}
