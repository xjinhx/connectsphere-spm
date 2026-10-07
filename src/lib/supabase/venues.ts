import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Venue Catalogue queries (EP-08).
 *
 * Per docs/architecture.md, both the Supabase client and the query building
 * live in src/lib/. src/domain/venues/service.ts calls these functions and
 * never holds a client or writes a .from() of its own.
 *
 * Each function returns the raw Supabase result. Error mapping and domain
 * types are the service's job, not this file's.
 */

/** createAdminClient memoises its client, so calling it per query is free. */
function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/** SCRUM-121 AC1: name, location and maximum capacity are all the list needs. */
const VENUE_SUMMARY_SELECT = 'id, name, max_capacity, is_retired, locations ( id, name )';

/** SCRUM-121 AC2: the full venue page, including turnaround values. */
const VENUE_DETAIL_SELECT =
  'id, name, max_capacity, is_retired, operating_slots, needs_setup_slot, needs_turnaround_slot, created_at, updated_at, locations ( id, name ), venue_facilities ( facilities ( id, name ) ), venue_accessibility_features ( accessibility_features ( id, name ) ), venue_layouts ( layout, capacity )';

// -----------------------------------------------------------------------------
// Reading the catalogue
// -----------------------------------------------------------------------------

/**
 * SCRUM-121 AC1 and AC3.
 * Retired venues are left out unless they were explicitly asked for.
 */
export async function fetchVenueSummaries(includeRetired: boolean) {
  const query = db().from('venues').select(VENUE_SUMMARY_SELECT).order('name');
  return includeRetired ? await query : await query.eq('is_retired', false);
}

/** SCRUM-121 AC2. maybeSingle so a missing id comes back as null, not an error. */
export async function fetchVenueDetail(venueId: string) {
  return db().from('venues').select(VENUE_DETAIL_SELECT).eq('id', venueId).maybeSingle();
}

// -----------------------------------------------------------------------------
// The maintained reference lists (SCRUM-116 AC1, SCRUM-117 AC1 and AC2)
// -----------------------------------------------------------------------------

export async function fetchLocations() {
  return db().from('locations').select('id, name').order('name');
}

export async function fetchFacilities() {
  return db().from('facilities').select('id, name').order('name');
}

export async function fetchAccessibilityFeatures() {
  return db().from('accessibility_features').select('id, name').order('name');
}

/** Used to confirm a chosen id really is on the maintained list before writing. */
export async function fetchLocationById(locationId: string) {
  return db().from('locations').select('id').eq('id', locationId).maybeSingle();
}

export async function fetchFacilityIdsIn(facilityIds: string[]) {
  return db().from('facilities').select('id').in('id', facilityIds);
}

export async function fetchAccessibilityFeatureIdsIn(featureIds: string[]) {
  return db().from('accessibility_features').select('id').in('id', featureIds);
}

// -----------------------------------------------------------------------------
// Writing a venue (SCRUM-116, SCRUM-117, SCRUM-118, SCRUM-120)
//
// Each save is one call to a database function (migration
// 20260923120000_venue_save_in_one_transaction.sql), so the venue and its
// lists are written in one transaction: all of it lands or none of it does.
// supabase-js has no transactions of its own. Found reviewing SCRUM-215: the
// separate inserts and deletes that were here could leave a venue half-saved.
// -----------------------------------------------------------------------------

export type VenueLayoutRow = { layout: string; capacity: number };

/** SCRUM-116 AC1 to AC4, SCRUM-117 AC1 and AC2, SCRUM-118 AC1. Returns the new venue's id. */
export async function createVenueWithLists(venue: {
  name: string;
  locationId: string;
  maxCapacity: number;
  operatingSlots: string[];
  facilityIds: string[];
  accessibilityFeatureIds: string[];
  layouts: VenueLayoutRow[];
}) {
  return db().rpc('create_venue', {
    p_name: venue.name,
    p_location_id: venue.locationId,
    p_max_capacity: venue.maxCapacity,
    p_operating_slots: venue.operatingSlots,
    p_facility_ids: venue.facilityIds,
    p_accessibility_feature_ids: venue.accessibilityFeatureIds,
    p_layouts: venue.layouts,
  });
}

/**
 * SCRUM-120 AC1, SCRUM-117 AC3, SCRUM-118. Only saves while the venue's
 * updated_at is still `expectedUpdatedAt`, the version the editor loaded.
 *
 * A field left undefined is not sent and stays as it is. A list that is sent
 * replaces the whole list, so an empty one removes them all (SCRUM-117 AC3).
 * Resolves to 'updated', 'stale', 'not_found' or 'affected_bookings'; the last
 * three write nothing.
 *
 * SCRUM-120 AC2 to AC4: a capacity cut that affects a confirmed future booking
 * resolves to 'affected_bookings' unless `confirmAffectedBookings` is true, in
 * which case the cut is saved together with a notice per affected event.
 * `today` is the Singapore date (YYYY-MM-DD) "future" is judged against; left
 * out, the function works out the Singapore date itself.
 */
export async function saveVenueChanges(
  venueId: string,
  expectedUpdatedAt: string,
  changes: {
    name?: string;
    locationId?: string;
    maxCapacity?: number;
    operatingSlots?: string[];
    facilityIds?: string[];
    accessibilityFeatureIds?: string[];
    layouts?: VenueLayoutRow[];
    needsSetupSlot?: boolean;
    needsTurnaroundSlot?: boolean;
  },
  { confirmAffectedBookings = false, today }: { confirmAffectedBookings?: boolean; today?: string } = {},
) {
  return db().rpc('update_venue', {
    p_venue_id: venueId,
    p_expected_updated_at: expectedUpdatedAt,
    ...(changes.name !== undefined && { p_name: changes.name }),
    ...(changes.locationId !== undefined && { p_location_id: changes.locationId }),
    ...(changes.maxCapacity !== undefined && { p_max_capacity: changes.maxCapacity }),
    ...(changes.operatingSlots !== undefined && { p_operating_slots: changes.operatingSlots }),
    ...(changes.facilityIds !== undefined && { p_facility_ids: changes.facilityIds }),
    ...(changes.needsSetupSlot !== undefined && { p_needs_setup_slot: changes.needsSetupSlot }),
    ...(changes.needsTurnaroundSlot !== undefined && { p_needs_turnaround_slot: changes.needsTurnaroundSlot }),
    ...(changes.accessibilityFeatureIds !== undefined && {
      p_accessibility_feature_ids: changes.accessibilityFeatureIds,
    }),
    ...(changes.layouts !== undefined && { p_layouts: changes.layouts }),
    p_confirm_affected_bookings: confirmAffectedBookings,
    ...(today !== undefined && { p_today: today }),
  });
}

/**
 * SCRUM-120 AC2: a venue's confirmed bookings on or after `today` (a Singapore
 * date, YYYY-MM-DD), with what the check needs from each booking's event.
 *
 * Bookings are written by SCRUM-148's approval, one per venue, date and slot,
 * so "future" is the booking's own date (D-04 replaced). An event with several
 * booked slots comes back once per slot; the service counts it once.
 */
export async function fetchConfirmedFutureBookings(venueId: string, today: string) {
  return db()
    .from('venue_booking')
    .select(
      'date, event_request:event_request_id!inner (id, reference, name, proposed_date, expected_attendance, coordinator_id)',
    )
    .eq('venue_id', venueId)
    .eq('status', 'confirmed')
    .gte('date', today);
}

// -----------------------------------------------------------------------------
// SCRUM-128: searching by date and slot
// -----------------------------------------------------------------------------

/**
 * SCRUM-128: every venue a search could return, with the slots each one runs.
 * Retired venues are left out, the same default as the catalogue list
 * (SCRUM-121 AC3): a retired venue can't host a new event.
 */
export async function fetchSearchableVenues() {
  return db()
    .from('venues')
    .select('id, name, max_capacity, is_retired, operating_slots, locations ( id, name )')
    .eq('is_retired', false)
    .order('name');
}

/**
 * SCRUM-128 AC2 and AC3: every confirmed booking on `date`, with the slot it
 * takes. Each booking has its own date and slot (SCRUM-148).
 */
export async function fetchConfirmedBookingsOn(date: string) {
  return db().from('venue_booking').select('venue_id, slot').eq('status', 'confirmed').eq('date', date);
}

/**
 * SCRUM-128 AC4: every slot recorded as unavailable on `date`. SCRUM-151's
 * flow writes these rows (POST /api/venues/[id]/unavailable-slots).
 */
export async function fetchUnavailableSlotsOn(date: string) {
  return db().from('venue_unavailable_slot').select('venue_id, slot').eq('date', date);
}

/**
 * SCRUM-154 AC4 and AC5: one venue's slots recorded as unavailable on the
 * given dates. The reason is not read: the refusal names the slot only.
 */
export async function fetchUnavailableSlotsForVenue(venueId: string, dates: readonly string[]) {
  return db()
    .from('venue_unavailable_slot')
    .select('date, slot')
    .eq('venue_id', venueId)
    .in('date', [...dates]);
}

// -----------------------------------------------------------------------------
// SCRUM-123: a venue's calendar over a date range
// -----------------------------------------------------------------------------

/**
 * SCRUM-123 AC7: the venue's unavailable slots from `from` to `to`, with the
 * recorded reason. Venue Staff record them through SCRUM-151.
 */
export async function fetchUnavailableSlotsBetween(venueId: string, from: string, to: string) {
  return db()
    .from('venue_unavailable_slot')
    .select('date, slot, reason')
    .eq('venue_id', venueId)
    .gte('date', from)
    .lte('date', to);
}

/**
 * SCRUM-123 AC6 and AC8: the venue's pending booking request lines from `from`
 * to `to`. The lines are SCRUM-142's (venue_booking_request_line); this only
 * reads them.
 */
export async function fetchPendingRequestLinesBetween(venueId: string, from: string, to: string) {
  return db()
    .from('venue_booking_request_line')
    .select('date, time_slots, request:request_id!inner (venue_id)')
    .eq('request.venue_id', venueId)
    .eq('status', 'pending')
    .gte('date', from)
    .lte('date', to);
}
