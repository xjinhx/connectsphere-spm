import {
  createVenueWithLists,
  fetchAccessibilityFeatureIdsIn,
  fetchAccessibilityFeatures,
  fetchConfirmedFutureBookings,
  fetchFacilities,
  fetchFacilityIdsIn,
  fetchLocationById,
  fetchLocations,
  fetchSearchableVenues,
  fetchVenueDetail,
  fetchVenueSummaries,
  saveVenueChanges,
} from '@/lib/supabase/venues';
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from '@/domain/shared/errors';
import { todayInSingapore, type ISODate } from '@/domain/shared/dates';
import { fromDatabaseTime } from '@/domain/shared/times';
import { getCommittedPeriods } from '@/domain/availability/service';
import { assertLayoutsWithinMaxCapacity, isAffectedByCapacity, isCapacityCut, isWithinOpeningHours } from './policy';
import {
  AffectedBookingSchema,
  CreateVenueInputSchema,
  OPERATING_SLOTS,
  ROOM_LAYOUTS,
  UpdateVenueInputSchema,
  VenueDetailSchema,
  VenueFormOptionsSchema,
  VenueIdSchema,
  VenueSearchQuerySchema,
  VenueSearchResultSchema,
  VenueSummarySchema,
  type AffectedBooking,
  type AffectedBookingsDetails,
  type VenueDetail,
  type VenueFormOptions,
  type VenueLayoutInput,
  type VenueSearchResult,
  type VenueSummary,
} from './schema';

/**
 * Venue Catalogue service (EP-08).
 *
 * SCRUM-116 Add a venue          SCRUM-120 Update venue information
 * SCRUM-117 Facilities/access    SCRUM-121 Browse and view the catalogue
 * SCRUM-118 Room layouts       SCRUM-128 Search by date and slot
 *                              (SCRUM-123's calendar is in calendar.ts)
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
/**
 * SCRUM-239 AC2 and AC8: search venues by a date and an exact start and end time,
 * replacing SCRUM-128's slots (which stays Done on slots, per the Week 7 guide).
 *
 * A venue is returned only if the whole period is inside its opening hours
 * (AC1: "search does not return that venue for it") and nothing commits any of
 * it. Commitments come from getCommittedPeriods, the one availability check
 * agreed on day 1: confirmed bookings (AC2) and periods Venue Staff marked
 * unavailable (AC8, carrying SCRUM-128 AC4 to time ranges). A pending request
 * commits nothing.
 * SCRUM-128 AC5 (no booking horizon) still holds: the schema sets no limit.
 *
 * One availability check per open venue. The catalogue is small, so this is
 * simpler than a second, catalogue-wide copy of the overlap rule.
 */
export async function searchVenues(input: unknown): Promise<VenueSearchResult> {
  const parsed = VenueSearchQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The search could not be run.', parsed.error.flatten());
  }
  const { date, start, end } = parsed.data;

  const venues = await fetchSearchableVenues();
  if (venues.error || !venues.data) {
    throw new ValidationError('Could not load the venue catalogue.', venues.error?.message);
  }

  const open = venues.data.filter((venue) =>
    isWithinOpeningHours(
      { start, end },
      { opensAt: fromDatabaseTime(venue.opens_at), closesAt: fromDatabaseTime(venue.closes_at) },
    ),
  );
  const checked = await Promise.all(
    open.map(async (venue) => ({
      venue,
      committed: await getCommittedPeriods(venue.id, `${date}T${start}`, `${date}T${end}`),
    })),
  );
  const free = checked.filter(({ committed }) => committed.length === 0).map(({ venue }) => venue);

  return VenueSearchResultSchema.parse({
    date,
    start,
    end,
    venues: free.map((row) => ({
      id: row.id,
      name: row.name,
      location: requireLocation(row.locations, row.name),
      maxCapacity: row.max_capacity,
      isRetired: row.is_retired,
    })),
  });
}

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
    needsSetupSlot: data.needs_setup_slot,
    needsTurnaroundSlot: data.needs_turnaround_slot,
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
 * SCRUM-120 AC2: the 409 that shows the editor which confirmed future bookings
 * their cut affects and asks them to confirm it. `reason` tells the form this
 * apart from the other two 409s (a duplicate name, a form out of date).
 */
function affectedBookingsError(maxCapacity: number, bookings: AffectedBooking[]): ConflictError {
  const count = bookings.length === 1 ? '1 confirmed future booking' : `${bookings.length} confirmed future bookings`;
  const details: AffectedBookingsDetails = { reason: 'affected_bookings', maxCapacity, bookings };
  return new ConflictError(
    `Lowering the maximum capacity to ${maxCapacity} puts ${count} over capacity. Confirm to apply the change; the coordinator of each affected event will be notified.`,
    details,
  );
}


/**
 * SCRUM-120 AC1 to AC4, SCRUM-117 AC3, SCRUM-118.
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
 * SCRUM-120 AC2 to AC4: a cut below a confirmed future booking's expected
 * attendance is refused with the list of those bookings until the editor
 * confirms it (AC2); a cut down to exactly the attendance is not a problem
 * (AC3); a confirmed cut is saved together with a notice to each affected
 * event's coordinator (AC4). The service checks first so it can show the list;
 * update_venue checks again inside the save, so a booking confirmed in between
 * is still caught, and the cut and its notices are one transaction.
 */
export async function updateVenue(venueId: string, input: unknown): Promise<VenueDetail> {
  const parsed = UpdateVenueInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The venue could not be updated.', parsed.error.flatten());
  }
  const { expectedUpdatedAt, confirmAffectedBookings = false, ...changes } = parsed.data;

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

  // SCRUM-120 AC2 and AC3. Checked last, so an edit that is refused for
  // another reason never asks the editor to confirm first. `today` is decided
  // once and handed to the save too, so the list the editor is shown and the
  // check inside update_venue judge "future" against the same Singapore date.
  const today = todayInSingapore();
  const proposedMaxCapacity = changes.maxCapacity;
  const cutsCapacity = proposedMaxCapacity !== undefined && isCapacityCut(current.maxCapacity, proposedMaxCapacity);
  if (cutsCapacity && !confirmAffectedBookings) {
    const affected = await findAffectedFutureBookings(current.id, proposedMaxCapacity, today);
    if (affected.length > 0) {
      throw affectedBookingsError(proposedMaxCapacity, affected);
    }
  }

  const { data: outcome, error } = await saveVenueChanges(
    current.id,
    expectedUpdatedAt,
    {
      name: changes.name,
      locationId: changes.locationId,
      maxCapacity: changes.maxCapacity,
      operatingSlots: changes.operatingSlots === undefined ? undefined : [...changes.operatingSlots],
      facilityIds: changes.facilityIds,
      accessibilityFeatureIds: changes.accessibilityFeatureIds,
      layouts: changes.layouts,
      needsSetupSlot: changes.needsSetupSlot,
      needsTurnaroundSlot: changes.needsTurnaroundSlot,
    },
    { confirmAffectedBookings, today },
  );

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
  // A booking was confirmed between the check above and the save. Show the
  // editor the list as it is now, so what they confirm is what is there.
  if (outcome === 'affected_bookings' && cutsCapacity) {
    const affected = await findAffectedFutureBookings(current.id, proposedMaxCapacity, today);
    if (affected.length > 0) {
      throw affectedBookingsError(proposedMaxCapacity, affected);
    }
  }
  if (outcome !== 'updated') {
    throw new ValidationError('The venue could not be updated.');
  }

  return getVenue(current.id);
}

// -----------------------------------------------------------------------------
// SCRUM-120 AC2: which confirmed future bookings a capacity cut affects
// -----------------------------------------------------------------------------

/**
 * The events with a confirmed booking at this venue on or after today whose
 * expected attendance is above `proposedMaxCapacity` (isAffectedByCapacity).
 *
 * Bookings are SCRUM-148's, one per venue, date and slot (D-04 replaced), so
 * an event booked for several slots is listed once.
 *
 * "Today" is Singapore's date, not the server's: the server runs in UTC, which
 * is still on yesterday until 08:00 in Singapore, and would count an event
 * that has already happened as a future booking.
 */
export async function findAffectedFutureBookings(
  venueId: string,
  proposedMaxCapacity: number,
  today: ISODate = todayInSingapore(),
): Promise<AffectedBooking[]> {
  const { data, error } = await fetchConfirmedFutureBookings(venueId, today);

  if (error || !data) {
    throw new ValidationError("Could not check the venue's bookings.", error?.message);
  }

  const events = [...new Map(data.map((row) => [row.event_request.id, row.event_request])).values()];

  return events
    .filter((event) => isAffectedByCapacity(event.expected_attendance, proposedMaxCapacity))
    .map((event) =>
      AffectedBookingSchema.parse({
        eventId: event.id,
        reference: event.reference,
        eventName: event.name,
        proposedDate: event.proposed_date,
        expectedAttendance: event.expected_attendance,
        coordinatorId: event.coordinator_id,
      }),
    );
}
