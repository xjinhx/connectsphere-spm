import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { createVenueWithLists, saveVenueChanges } from '@/lib/supabase/venues';
import { createVenue, getVenue, updateVenue } from '@/domain/venues/service';

/**
 * SCRUM-116 Add a venue · SCRUM-120 Update venue information
 * (with SCRUM-117 AC3 and SCRUM-118, which are saved on the same form)
 *
 * Found reviewing SCRUM-215, the same kind of bug as that one:
 *   - a save was several separate writes, so a failure part-way left the venue
 *     half-saved;
 *   - nothing checked the editor's form was still current, so a save from an
 *     older form silently undid a newer one, and two saves at once could both
 *     pass SCRUM-118's "no layout above the maximum" against the old values.
 * Both saves are now one database function each
 * (20260923120000_venue_save_in_one_transaction.sql), and an update carries the
 * updatedAt its form was loaded with.
 *
 * Runs against the local Supabase stack, like the CI job. Postgres is the
 * point: the transaction, the row lock and the version check all live there.
 * CI builds the database with no seed, so every row here is this file's own.
 * The admin client arranges rows; that is setup, not the code under test.
 */

const admin = createAdminClient();
const anon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const NOWHERE = '00000000-0000-4000-8000-000000000000';

let locationId: string;
let projectorId: string;
let whiteboardId: string;
let stepFreeId: string;
const venueIds: string[] = [];

async function insertReference(table: 'locations' | 'facilities' | 'accessibility_features', name: string) {
  const { data, error } = await admin.from(table).insert({ name: `${name} ${RUN}` }).select('id').single();
  if (error || !data) throw new Error(`could not create test ${table} row: ${error?.message}`);
  return data.id as string;
}

/** A venue of this file's own, holding a projector, step-free access and a 100-seat theatre layout. */
async function createTestVenue(label: string, maxCapacity = 200) {
  const venue = await createVenue({
    name: `${label} ${RUN}`,
    locationId,
    maxCapacity,
    facilityIds: [projectorId],
    accessibilityFeatureIds: [stepFreeId],
    layouts: [{ layout: 'theatre', capacity: 100 }],
  });
  venueIds.push(venue.id);
  return venue;
}

beforeAll(async () => {
  locationId = await insertReference('locations', 'Venue Save Location');
  projectorId = await insertReference('facilities', 'Venue Save Projector');
  whiteboardId = await insertReference('facilities', 'Venue Save Whiteboard');
  stepFreeId = await insertReference('accessibility_features', 'Venue Save Step-free');
});

afterAll(async () => {
  // Venues first: their links cascade, and a location or facility still in use
  // cannot be deleted.
  for (const id of venueIds) await admin.from('venues').delete().eq('id', id);
  await admin.from('facilities').delete().in('id', [projectorId, whiteboardId].filter(Boolean));
  if (stepFreeId) await admin.from('accessibility_features').delete().eq('id', stepFreeId);
  if (locationId) await admin.from('locations').delete().eq('id', locationId);
});

describe('updateVenue: an edit is made from the version the editor loaded', () => {
  it('SCRUM-120 AC1 saves the change and moves the version on', async () => {
    const venue = await createTestVenue('Current Form Hall');

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 250 });

    expect(saved.maxCapacity).toBe(250);
    expect(Date.parse(saved.updatedAt)).toBeGreaterThan(Date.parse(venue.updatedAt));
  });

  it('refuses an edit from a form opened before another save, and keeps the newer save', async () => {
    const venue = await createTestVenue('Stale Form Hall');
    // Staff B opened the form at the same time and saved first.
    await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, facilityIds: [projectorId, whiteboardId] });

    // Staff A, still on the form loaded before B's save, changes the capacity.
    await expect(
      updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 150, facilityIds: [projectorId] }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'venue_changed' } });

    const after = await getVenue(venue.id);
    expect(after.maxCapacity).toBe(200);
    expect(after.facilities.map((facility) => facility.id).sort()).toEqual([projectorId, whiteboardId].sort());
  });

  // Deterministic in both orders, like SCRUM-215's reassignment test: if the
  // two overlap, the row lock makes the second wait and then see the new
  // version; if one finishes first, the second is already out of date.
  it('two edits from the same version at once: exactly one is saved', async () => {
    const venue = await createTestVenue('Race Hall');

    const results = await Promise.allSettled([
      updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 150 }),
      updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, name: `Race Hall Renamed ${RUN}` }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });

    const after = await getVenue(venue.id);
    const capacityChanged = after.maxCapacity === 150;
    const renamed = after.name === `Race Hall Renamed ${RUN}`;
    expect(capacityChanged !== renamed).toBe(true);
  });

  // SCRUM-118 AC3. Each edit on its own passes the rule against the version it
  // was made from; together they would leave a 200-seat layout in a venue of
  // maximum 100.
  it('two edits at once cannot together leave a layout above the maximum capacity', async () => {
    const venue = await createTestVenue('Write Skew Hall');

    const results = await Promise.allSettled([
      updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, maxCapacity: 100 }),
      updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, layouts: [{ layout: 'theatre', capacity: 200 }] }),
    ]);

    // One is saved and the other refused because the venue changed, not for
    // some other reason that would also leave the rule intact.
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'venue_changed' },
    });

    const after = await getVenue(venue.id);
    for (const layout of after.layouts) {
      expect(layout.capacity).toBeLessThanOrEqual(after.maxCapacity);
    }
  });

  it('SCRUM-118 replaces the layouts with the list that was sent', async () => {
    const venue = await createTestVenue('Layout Edit Hall');

    const saved = await updateVenue(venue.id, {
      expectedUpdatedAt: venue.updatedAt,
      layouts: [
        { layout: 'banquet', capacity: 80 },
        { layout: 'theatre', capacity: 150 },
      ],
    });

    expect([...saved.layouts].sort((a, b) => a.layout.localeCompare(b.layout))).toEqual([
      { layout: 'banquet', capacity: 80 },
      { layout: 'theatre', capacity: 150 },
    ]);
    expect(saved.facilities.map((facility) => facility.id)).toEqual([projectorId]);
  });

  it('SCRUM-117 AC3 an empty list removes them all, and a list left out is kept', async () => {
    const venue = await createTestVenue('Empty List Hall');

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, accessibilityFeatureIds: [] });

    expect(saved.accessibilityFeatures).toEqual([]);
    expect(saved.facilities.map((facility) => facility.id)).toEqual([projectorId]);
    expect(saved.layouts).toEqual([{ layout: 'theatre', capacity: 100 }]);
  });

  it('reports an unknown venue as not found', async () => {
    await expect(
      updateVenue(NOWHERE, { expectedUpdatedAt: new Date().toISOString(), maxCapacity: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('a save is all or nothing', () => {
  // Calls the data layer directly with a facility that does not exist, which
  // the service would have refused before writing. The rename is written
  // first inside the function, so if the save were not one transaction it
  // would survive the failure.
  it('an edit that fails part-way changes nothing, not even the fields written before the failure', async () => {
    const venue = await createTestVenue('Atomic Edit Hall');

    const { error } = await saveVenueChanges(venue.id, venue.updatedAt, {
      name: `Atomic Edit Renamed ${RUN}`,
      maxCapacity: 300,
      facilityIds: [NOWHERE],
    });

    expect(error?.code).toBe('23503');
    const after = await getVenue(venue.id);
    expect(after.name).toBe(venue.name);
    expect(after.maxCapacity).toBe(200);
    expect(after.facilities.map((facility) => facility.id)).toEqual([projectorId]);
    expect(after.updatedAt).toBe(venue.updatedAt);
  });

  it('a create that fails part-way leaves no venue behind', async () => {
    const name = `Atomic Create Hall ${RUN}`;

    const { error } = await createVenueWithLists({
      name,
      locationId,
      maxCapacity: 50,
      operatingSlots: ['am'],
      facilityIds: [NOWHERE],
      accessibilityFeatureIds: [],
      layouts: [],
    });

    expect(error?.code).toBe('23503');
    const { count } = await admin.from('venues').select('id', { count: 'exact', head: true }).eq('name', name);
    expect(count).toBe(0);
  });

  // SCRUM-116 AC2 still holds through the function: the unique index refuses
  // the duplicate, and the whole save goes with it.
  it('SCRUM-116 AC2 refuses a duplicate name in any letter case, on create and on rename', async () => {
    const first = await createTestVenue('Unique Name Hall');
    const second = await createTestVenue('Other Name Hall');

    await expect(
      createVenue({ name: first.name.toUpperCase(), locationId, maxCapacity: 10 }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { name: first.name.toUpperCase() } });
    await expect(
      updateVenue(second.id, { expectedUpdatedAt: second.updatedAt, name: first.name.toLowerCase() }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { name: first.name.toLowerCase() } });

    expect((await getVenue(second.id)).name).toBe(second.name);
  });
});

describe('only the server can run the save functions', () => {
  it('the public anon key is refused, and nothing changes', async () => {
    const venue = await createTestVenue('Anon Hall');

    const { error } = await anon.rpc('update_venue', {
      p_venue_id: venue.id,
      p_expected_updated_at: venue.updatedAt,
      p_max_capacity: 1,
    });

    expect(error?.code).toBe('42501');
    expect((await getVenue(venue.id)).maxCapacity).toBe(200);
  });
});

describe('updateVenue: SCRUM-119 setup, teardown and turnaround requirements', () => {
  it('TC-119-01 saves all three values and returns them', async () => {
    const venue = await createTestVenue('Turnaround Hall');

    const saved = await updateVenue(venue.id, {
      expectedUpdatedAt: venue.updatedAt,
      setupMinutes: 15,
      teardownMinutes: 20,
      turnaroundMinutes: 30,
    });

    expect(saved.setupMinutes).toBe(15);
    expect(saved.teardownMinutes).toBe(20);
    expect(saved.turnaroundMinutes).toBe(30);

    const reread = await getVenue(venue.id);
    expect(reread.setupMinutes).toBe(15);
    expect(reread.teardownMinutes).toBe(20);
    expect(reread.turnaroundMinutes).toBe(30);
  });

  it('TC-119-07 two venues keep independent turnaround values', async () => {
    const venueA = await createTestVenue('Independent Hall A');
    const venueB = await createTestVenue('Independent Hall B');

    await updateVenue(venueA.id, { expectedUpdatedAt: venueA.updatedAt, turnaroundMinutes: 30 });
    await updateVenue(venueB.id, { expectedUpdatedAt: venueB.updatedAt, turnaroundMinutes: 45 });

    expect((await getVenue(venueA.id)).turnaroundMinutes).toBe(30);
    expect((await getVenue(venueB.id)).turnaroundMinutes).toBe(45);
  });

  it('TC-119-09 a value can be changed independently of the others left unset', async () => {
    const venue = await createTestVenue('Partial Update Hall');
    await updateVenue(venue.id, {
      expectedUpdatedAt: venue.updatedAt,
      setupMinutes: 10,
      teardownMinutes: 10,
      turnaroundMinutes: 10,
    });

    const midway = await getVenue(venue.id);
    const saved = await updateVenue(venue.id, { expectedUpdatedAt: midway.updatedAt, teardownMinutes: 45 });

    expect(saved.setupMinutes).toBe(10);
    expect(saved.teardownMinutes).toBe(45);
    expect(saved.turnaroundMinutes).toBe(10);
  });

  it('TC-119-11 a turnaround above the slot gap is refused, then saved once confirmed', async () => {
    const venue = await createTestVenue('Confirm Turnaround Hall');

    await expect(
      updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 90 }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'turnaround_impact', turnaroundMinutes: 90, slotGapMinutes: 60 },
    });

    // Refused, so nothing was written - confirm the value is still unset.
    expect((await getVenue(venue.id)).turnaroundMinutes).toBeNull();

    const saved = await updateVenue(venue.id, {
      expectedUpdatedAt: venue.updatedAt,
      turnaroundMinutes: 90,
      confirmTurnaroundImpact: true,
    });

    expect(saved.turnaroundMinutes).toBe(90);
  });

  it('a turnaround exactly at the slot gap saves with no confirmation needed', async () => {
    const venue = await createTestVenue('Exact Gap Hall');

    const saved = await updateVenue(venue.id, { expectedUpdatedAt: venue.updatedAt, turnaroundMinutes: 60 });

    expect(saved.turnaroundMinutes).toBe(60);
  });
});
