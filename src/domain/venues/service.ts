import {
  deleteVenue,
  deleteVenueAccessibilityFeatures,
  deleteVenueFacilities,
  deleteVenueLayouts,
  fetchAccessibilityFeatureIdsIn,
  fetchAccessibilityFeatures,
  fetchFacilities,
  fetchFacilityIdsIn,
  fetchLocationById,
  fetchLocations,
  fetchVenueDetail,
  fetchVenueSummaries,
  insertVenue,
  insertVenueAccessibilityFeatures,
  insertVenueFacilities,
  insertVenueLayouts,
  updateVenueRow,
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

/** SCRUM-121 AC2: the full venue page, including the turnaround values. */
export async function getVenue(venueId: string): Promise<VenueDetail> {
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
 * supabase-js has no transactions. If the venue lands but a link insert fails,
 * the venue is deleted again and the foreign keys cascade. An RPC function
 * would make this genuinely atomic; that is a known limitation, not a design
 * choice worth defending.
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

  const { data: created, error: insertError } = await insertVenue({
    name: venue.name,
    location_id: venue.locationId,
    max_capacity: venue.maxCapacity,
    operating_slots: [...venue.operatingSlots],
  });

  // SCRUM-116 AC2: the unique index on lower(name) is what actually enforces this.
  if (insertError) {
    if (isUniqueViolation(insertError)) {
      throw new ConflictError('Venue name is already in use.', { name: venue.name });
    }
    throw new ValidationError('The venue could not be saved.', insertError.message);
  }
  if (!created) {
    throw new ValidationError('The venue could not be saved.');
  }

  try {
    await replaceVenueLinks(created.id, {
      facilityIds: venue.facilityIds,
      accessibilityFeatureIds: venue.accessibilityFeatureIds,
      layouts: venue.layouts,
    });
  } catch (error) {
    await deleteVenue(created.id);
    throw error;
  }

  return getVenue(created.id);
}

// -----------------------------------------------------------------------------
// Updating (SCRUM-120, SCRUM-117 AC3, SCRUM-118)
// -----------------------------------------------------------------------------

/**
 * SCRUM-120 AC1, SCRUM-117 AC3, SCRUM-118.
 *
 * A field that was left out is left alone. A list that was sent replaces the
 * whole list, so removing a facility means sending the list without it.
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
  const changes = parsed.data;

  // Throws NotFoundError if the venue is not there.
  const current = await getVenue(venueId);

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

  const { error: updateError } = await updateVenueRow(venueId, {
    ...(changes.name !== undefined && { name: changes.name }),
    ...(changes.locationId !== undefined && { location_id: changes.locationId }),
    ...(changes.maxCapacity !== undefined && { max_capacity: changes.maxCapacity }),
    ...(changes.operatingSlots !== undefined && { operating_slots: [...changes.operatingSlots] }),
    updated_at: new Date().toISOString(),
  });

  if (updateError) {
    if (isUniqueViolation(updateError)) {
      throw new ConflictError('Venue name is already in use.', { name: changes.name });
    }
    throw new ValidationError('The venue could not be updated.', updateError.message);
  }

  await replaceVenueLinks(venueId, {
    facilityIds: changes.facilityIds,
    accessibilityFeatureIds: changes.accessibilityFeatureIds,
    layouts: changes.layouts,
  });

  return getVenue(venueId);
}

/**
 * Replaces whichever lists were supplied. Undefined means "not sent", so the
 * existing rows stay; an empty array means "remove them all".
 */
async function replaceVenueLinks(
  venueId: string,
  lists: {
    facilityIds?: string[];
    accessibilityFeatureIds?: string[];
    layouts?: VenueLayoutInput[];
  },
): Promise<void> {
  if (lists.facilityIds !== undefined) {
    const removed = await deleteVenueFacilities(venueId);
    if (removed.error) {
      throw new ValidationError('The facilities could not be saved.', removed.error.message);
    }
    if (lists.facilityIds.length > 0) {
      const added = await insertVenueFacilities(
        lists.facilityIds.map((facilityId) => ({ venue_id: venueId, facility_id: facilityId })),
      );
      if (added.error) {
        throw new ValidationError('The facilities could not be saved.', added.error.message);
      }
    }
  }

  if (lists.accessibilityFeatureIds !== undefined) {
    const removed = await deleteVenueAccessibilityFeatures(venueId);
    if (removed.error) {
      throw new ValidationError('The accessibility features could not be saved.', removed.error.message);
    }
    if (lists.accessibilityFeatureIds.length > 0) {
      const added = await insertVenueAccessibilityFeatures(
        lists.accessibilityFeatureIds.map((featureId) => ({
          venue_id: venueId,
          accessibility_feature_id: featureId,
        })),
      );
      if (added.error) {
        throw new ValidationError('The accessibility features could not be saved.', added.error.message);
      }
    }
  }

  if (lists.layouts !== undefined) {
    const removed = await deleteVenueLayouts(venueId);
    if (removed.error) {
      throw new ValidationError('The layouts could not be saved.', removed.error.message);
    }
    if (lists.layouts.length > 0) {
      const added = await insertVenueLayouts(
        lists.layouts.map((entry) => ({
          venue_id: venueId,
          layout: entry.layout,
          capacity: entry.capacity,
        })),
      );
      if (added.error) {
        throw new ValidationError('The layouts could not be saved.', added.error.message);
      }
    }
  }
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
 * TODO(SCRUM-148): there is no bookings table in Sprint 1, so nothing can be
 * affected yet and this always returns an empty list. When bookings land, this
 * takes the venue id and the proposed maximum capacity, and updateVenue must
 * refuse unless UpdateVenueInput.confirmAffectedBookings is true.
 *
 * TODO(EP-20): SCRUM-120 AC4 then notifies the coordinator assigned to each
 * affected event. No notification system exists in Sprint 1.
 *
 * Until both land, SCRUM-120 AC2, AC3 and AC4 stay unverifiable and the ticket
 * belongs in Merged - Pending Verification, not Done.
 */
export async function findAffectedFutureBookings(): Promise<AffectedBooking[]> {
  return [];
}
