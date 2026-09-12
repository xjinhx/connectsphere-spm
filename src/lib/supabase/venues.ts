import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TablesInsert, TablesUpdate } from './database.types';

/**
 * Venue Catalogue queries (EP-08).
 *
 * Same shape as profiles.ts: every function takes the Supabase client as its
 * first argument and hands back the raw Supabase result. No domain types, no
 * error mapping, no business rules. src/domain/venues/service.ts owns all of
 * that, which is what keeps domain/ free of Supabase.
 */

type Db = SupabaseClient<Database>;

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
export async function fetchVenueSummaries(supabase: Db, includeRetired: boolean) {
  const query = supabase.from('venues').select(VENUE_SUMMARY_SELECT).order('name');
  return includeRetired ? await query : await query.eq('is_retired', false);
}

/** SCRUM-121 AC2. maybeSingle so a missing id comes back as null, not an error. */
export async function fetchVenueDetail(supabase: Db, venueId: string) {
  return supabase.from('venues').select(VENUE_DETAIL_SELECT).eq('id', venueId).maybeSingle();
}

// -----------------------------------------------------------------------------
// The maintained reference lists (SCRUM-116 AC1, SCRUM-117 AC1 and AC2)
// -----------------------------------------------------------------------------

export async function fetchLocations(supabase: Db) {
  return supabase.from('locations').select('id, name').order('name');
}

export async function fetchFacilities(supabase: Db) {
  return supabase.from('facilities').select('id, name').order('name');
}

export async function fetchAccessibilityFeatures(supabase: Db) {
  return supabase.from('accessibility_features').select('id, name').order('name');
}

/** Used to confirm a chosen id really is on the maintained list before writing. */
export async function fetchLocationById(supabase: Db, locationId: string) {
  return supabase.from('locations').select('id').eq('id', locationId).maybeSingle();
}

export async function fetchFacilityIdsIn(supabase: Db, facilityIds: string[]) {
  return supabase.from('facilities').select('id').in('id', facilityIds);
}

export async function fetchAccessibilityFeatureIdsIn(supabase: Db, featureIds: string[]) {
  return supabase.from('accessibility_features').select('id').in('id', featureIds);
}

// -----------------------------------------------------------------------------
// Writing a venue (SCRUM-116, SCRUM-120)
// -----------------------------------------------------------------------------

export async function insertVenue(supabase: Db, venue: TablesInsert<'venues'>) {
  return supabase.from('venues').insert(venue).select('id').single();
}

export async function updateVenueRow(supabase: Db, venueId: string, patch: TablesUpdate<'venues'>) {
  return supabase.from('venues').update(patch).eq('id', venueId);
}

/**
 * Only ever used to undo a create whose link rows failed. supabase-js has no
 * transactions, so this is the compensating action; the foreign keys cascade,
 * so any link rows that did land go with it.
 */
export async function deleteVenue(supabase: Db, venueId: string) {
  return supabase.from('venues').delete().eq('id', venueId);
}

// -----------------------------------------------------------------------------
// Link rows (SCRUM-117 AC1 to AC3, SCRUM-118 AC1)
//
// Updates replace a list wholesale: delete every row for the venue, then insert
// what was sent. That is what makes SCRUM-117 AC3 work, since a facility left
// out of the list is a facility removed.
// -----------------------------------------------------------------------------

export async function insertVenueFacilities(supabase: Db, rows: TablesInsert<'venue_facilities'>[]) {
  return supabase.from('venue_facilities').insert(rows);
}

export async function deleteVenueFacilities(supabase: Db, venueId: string) {
  return supabase.from('venue_facilities').delete().eq('venue_id', venueId);
}

export async function insertVenueAccessibilityFeatures(
  supabase: Db,
  rows: TablesInsert<'venue_accessibility_features'>[],
) {
  return supabase.from('venue_accessibility_features').insert(rows);
}

export async function deleteVenueAccessibilityFeatures(supabase: Db, venueId: string) {
  return supabase.from('venue_accessibility_features').delete().eq('venue_id', venueId);
}

export async function insertVenueLayouts(supabase: Db, rows: TablesInsert<'venue_layouts'>[]) {
  return supabase.from('venue_layouts').insert(rows);
}

export async function deleteVenueLayouts(supabase: Db, venueId: string) {
  return supabase.from('venue_layouts').delete().eq('venue_id', venueId);
}
