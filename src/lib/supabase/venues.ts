import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database, TablesInsert, TablesUpdate } from './database.types';

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
  'id, name, max_capacity, is_retired, operating_slots, setup_minutes, teardown_minutes, turnaround_minutes, created_at, updated_at, locations ( id, name ), venue_facilities ( facilities ( id, name ) ), venue_accessibility_features ( accessibility_features ( id, name ) ), venue_layouts ( layout, capacity )';

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
// Writing a venue (SCRUM-116, SCRUM-120)
// -----------------------------------------------------------------------------

export async function insertVenue(venue: TablesInsert<'venues'>) {
  return db().from('venues').insert(venue).select('id').single();
}

export async function updateVenueRow(venueId: string, patch: TablesUpdate<'venues'>) {
  return db().from('venues').update(patch).eq('id', venueId);
}

/**
 * Only ever used to undo a create whose link rows failed. supabase-js has no
 * transactions, so this is the compensating action; the foreign keys cascade,
 * so any link rows that did land go with it.
 */
export async function deleteVenue(venueId: string) {
  return db().from('venues').delete().eq('id', venueId);
}

// -----------------------------------------------------------------------------
// Link rows (SCRUM-117 AC1 to AC3, SCRUM-118 AC1)
//
// Updates replace a list wholesale: delete every row for the venue, then insert
// what was sent. That is what makes SCRUM-117 AC3 work, since a facility left
// out of the list is a facility removed.
// -----------------------------------------------------------------------------

export async function insertVenueFacilities(rows: TablesInsert<'venue_facilities'>[]) {
  return db().from('venue_facilities').insert(rows);
}

export async function deleteVenueFacilities(venueId: string) {
  return db().from('venue_facilities').delete().eq('venue_id', venueId);
}

export async function insertVenueAccessibilityFeatures(
  rows: TablesInsert<'venue_accessibility_features'>[],
) {
  return db().from('venue_accessibility_features').insert(rows);
}

export async function deleteVenueAccessibilityFeatures(venueId: string) {
  return db().from('venue_accessibility_features').delete().eq('venue_id', venueId);
}

export async function insertVenueLayouts(rows: TablesInsert<'venue_layouts'>[]) {
  return db().from('venue_layouts').insert(rows);
}

export async function deleteVenueLayouts(venueId: string) {
  return db().from('venue_layouts').delete().eq('venue_id', venueId);
}
