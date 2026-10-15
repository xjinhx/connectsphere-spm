import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  assertEquipmentInCatalogue,
  createEquipmentItem,
  getEquipmentItem,
  listEquipment,
  listEquipmentOptions,
  updateEquipmentItem,
} from '@/domain/equipment/service';

/**
 * SCRUM-240 Maintain the equipment catalogue, against the local Supabase
 * stack. The rules on their own are in tests/unit/equipment-catalogue.test.ts,
 * and the service's orchestration with mocked queries is in
 * tests/unit/equipment-service.test.ts.
 *
 * What only a real database can show is here: that the item really lands in
 * the table with its four fields, that a new row's operational_status default
 * makes it Available, that a status is read back from the stored row rather
 * than from a cached list, and that a refusal leaves the stored row exactly as
 * it was.
 *
 * AC text is from the Jira card (authoritative):
 *   AC1 "Given I am Technical Support Staff, when I add an equipment item with
 *        a name, category, quantity and current location, then it is saved and
 *        listed in the catalogue."
 *   AC2 "Given an item exists, when I set its operational status to Available,
 *        Unavailable, Damaged or Under maintenance, then the new status is
 *        saved and shown in the catalogue."
 *   AC4 "Given I enter a quantity below zero or a non-integer, when I save,
 *        then it is refused and the quantity field is identified."
 *   AC5 "Given the catalogue holds items, when a coordinator records an
 *        equipment requirement (SCRUM-160), then they can only choose items
 *        that exist in the catalogue."
 *
 * AC3 is a permission rule with no database in it, so it is tested in the unit
 * file (TC-240-07 to TC-240-09) and by hand through the API and the page.
 *
 * Test case IDs are from the Sprint 3 sheet's SCRUM-240 tab (TC-240-nn).
 */

const admin = createAdminClient();
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let technicalSupportId: string;
const equipmentIds: string[] = [];

async function createUser(label: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `${label}+equipment${RUN}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`could not create test ${label}: ${error?.message ?? 'no user'}`);
  return data.user.id;
}

/** An item added through the service, remembered so it can be cleaned up. */
async function addItem(overrides: Record<string, unknown> = {}) {
  const item = await createEquipmentItem(
    {
      name: `Projector P-100 ${RUN}`,
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
      ...overrides,
    },
    technicalSupportId,
  );
  equipmentIds.push(item.id);
  return item;
}

/** The stored row, read straight from the table rather than through the service. */
async function storedRow(equipmentId: string) {
  const { data, error } = await admin.from('equipment').select('*').eq('id', equipmentId).single();
  if (error || !data) throw new Error(`could not read test equipment: ${error?.message}`);
  return data;
}

beforeAll(async () => {
  technicalSupportId = await createUser('technical-support');
});

afterAll(async () => {
  for (const id of equipmentIds) await admin.from('equipment').delete().eq('id', id);
  if (technicalSupportId) await admin.auth.admin.deleteUser(technicalSupportId);
});

// -----------------------------------------------------------------------------
// AC1 — the item is saved and listed
// -----------------------------------------------------------------------------

describe('SCRUM-240 AC1: adding an item to the catalogue', () => {
  it('TC-240-01 saves the name, category, quantity and location, and lists the item', async () => {
    const item = await addItem();

    // Saved: the stored row holds all four values.
    const row = await storedRow(item.id);
    expect(row).toMatchObject({
      name: `Projector P-100 ${RUN}`,
      category: 'av',
      quantity: 4,
      current_location: 'Bugis store room',
    });

    // Listed: it comes back from the catalogue, with its operational status.
    const listed = (await listEquipment()).find((candidate) => candidate.id === item.id);
    expect(listed).toMatchObject({
      name: `Projector P-100 ${RUN}`,
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
      operationalStatus: 'available',
    });
  });

  it('TC-240-02 adds nothing when the name, category and location are empty', async () => {
    const before = (await listEquipment()).length;

    await expect(
      createEquipmentItem({ name: '', category: '', quantity: 4, currentLocation: '' }, technicalSupportId),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    expect((await listEquipment()).length).toBe(before);
  });

  it('TC-240-03 lists a new item as Available without a status being chosen', async () => {
    const item = await addItem({
      name: `Flipchart stand FS-9 ${RUN}`,
      category: 'furniture',
      quantity: 6,
      currentLocation: 'Jurong East store room',
    });

    // The column default, not a value the service sent.
    expect((await storedRow(item.id)).operational_status).toBe('available');
    expect(item.operationalStatus).toBe('available');
  });

  it('records who added the item', async () => {
    const item = await addItem({ name: `Lectern LC-1 ${RUN}`, category: 'furniture', quantity: 2 });
    expect((await storedRow(item.id)).created_by).toBe(technicalSupportId);
  });
});

// -----------------------------------------------------------------------------
// AC2 — the four operational statuses
// -----------------------------------------------------------------------------

describe('SCRUM-240 AC2: setting an item\'s operational status', () => {
  it('TC-240-04 saves each of the four statuses, and the last one survives a fresh read', async () => {
    const item = await addItem({ name: `Status walk ${RUN}` });

    for (const status of ['unavailable', 'damaged', 'under_maintenance', 'available'] as const) {
      const updated = await updateEquipmentItem(item.id, { operationalStatus: status });
      expect(updated.operationalStatus).toBe(status);
      // Shown in the catalogue, read back from the stored row.
      expect((await storedRow(item.id)).operational_status).toBe(status);
    }

    await updateEquipmentItem(item.id, { operationalStatus: 'under_maintenance' });
    // A fresh read, as reloading the page makes: not a cached list.
    const reread = (await listEquipment()).find((candidate) => candidate.id === item.id);
    expect(reread?.operationalStatus).toBe('under_maintenance');
    expect((await getEquipmentItem(item.id)).operationalStatus).toBe('under_maintenance');
  });

  it('TC-240-05 refuses a status outside the four and leaves the stored status alone', async () => {
    const item = await addItem({ name: `Bad status ${RUN}` });

    await expect(updateEquipmentItem(item.id, { operationalStatus: 'Broken' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect((await storedRow(item.id)).operational_status).toBe('available');
  });

  it('TC-240-06 leaves the name, category, quantity and location alone on a status change', async () => {
    const item = await addItem({ name: `Untouched ${RUN}`, category: 'av', quantity: 4 });

    await updateEquipmentItem(item.id, { operationalStatus: 'damaged' });

    expect(await storedRow(item.id)).toMatchObject({
      name: `Untouched ${RUN}`,
      category: 'av',
      quantity: 4,
      current_location: 'Bugis store room',
      operational_status: 'damaged',
    });
  });
});

// -----------------------------------------------------------------------------
// AC4 — the quantity rule, on add and on edit
// -----------------------------------------------------------------------------

describe('SCRUM-240 AC4: the quantity rule', () => {
  it('TC-240-10 refuses -1 with the quantity field identified, then accepts 0', async () => {
    const before = (await listEquipment()).length;

    const refused = await createEquipmentItem(
      { name: `Wireless mic WM-3 ${RUN}`, category: 'av', quantity: -1, currentLocation: 'Bugis store room' },
      technicalSupportId,
    ).catch((error: unknown) => error);
    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((refused as { details: { fieldErrors: Record<string, string[]> } }).details.fieldErrors).toMatchObject({
      quantity: expect.any(Array),
    });
    expect((await listEquipment()).length).toBe(before);

    const item = await addItem({ name: `Wireless mic WM-3 ${RUN}`, quantity: 0 });
    expect((await storedRow(item.id)).quantity).toBe(0);
  });

  it.each([2.5, 'ten', undefined])('TC-240-11 refuses the quantity %o, identifying the field', async (quantity) => {
    const refused = await createEquipmentItem(
      { name: `Bad quantity ${RUN}`, category: 'av', quantity, currentLocation: 'Bugis store room' },
      technicalSupportId,
    ).catch((error: unknown) => error);

    expect(refused).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((refused as { details: { fieldErrors: Record<string, string[]> } }).details.fieldErrors).toMatchObject({
      quantity: expect.any(Array),
    });
  });

  it('TC-240-12 refuses -2 on an edit and leaves the stored quantity at 4', async () => {
    const item = await addItem({ name: `Edit quantity ${RUN}`, quantity: 4 });

    await expect(updateEquipmentItem(item.id, { quantity: -2 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    expect((await storedRow(item.id)).quantity).toBe(4);
  });

  it('TC-240-13 accepts 6 on an edit', async () => {
    const item = await addItem({ name: `Good edit ${RUN}`, quantity: 4 });

    const updated = await updateEquipmentItem(item.id, { quantity: 6 });

    expect(updated.quantity).toBe(6);
    expect((await storedRow(item.id)).quantity).toBe(6);
  });

  it('refuses a quantity below zero at the database too, not only in the schema', async () => {
    // equipment_quantity_not_negative is the backstop behind AC4's check.
    const { error } = await admin.from('equipment').insert({
      name: `Backstop ${RUN}`,
      category: 'av',
      quantity: -1,
      current_location: 'Bugis store room',
      created_by: technicalSupportId,
    });
    expect(error?.code).toBe('23514');
  });
});

// -----------------------------------------------------------------------------
// AC5 — the list a coordinator chooses from
// -----------------------------------------------------------------------------

describe('SCRUM-240 AC5: only catalogue items can be chosen', () => {
  it('TC-240-16 offers an item in every operational status, not only the available ones', async () => {
    const available = await addItem({ name: `Offer available ${RUN}` });
    const damaged = await addItem({ name: `Offer damaged ${RUN}` });
    const maintenance = await addItem({ name: `Offer maintenance ${RUN}` });
    await updateEquipmentItem(damaged.id, { operationalStatus: 'damaged' });
    await updateEquipmentItem(maintenance.id, { operationalStatus: 'under_maintenance' });

    const offered = await listEquipmentOptions();
    const offeredIds = offered.map((option) => option.id);

    // AC5 limits the choice to items that exist, not to items free on the
    // date; what is free when is equipment availability (SCRUM-166/167/170),
    // not in this sprint.
    expect(offeredIds).toContain(available.id);
    expect(offeredIds).toContain(damaged.id);
    expect(offeredIds).toContain(maintenance.id);
  });

  it('TC-240-14 lets a requirement that names a catalogue item through', async () => {
    const item = await addItem({ name: `Chosen ${RUN}` });
    await expect(assertEquipmentInCatalogue([item.id])).resolves.toBeUndefined();
  });

  it('TC-240-15 refuses an equipment id the catalogue does not hold', async () => {
    await expect(
      assertEquipmentInCatalogue(['44444444-4444-4444-8444-444444444444']),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('TC-240-15 refuses an item named by hand rather than chosen', async () => {
    await expect(assertEquipmentInCatalogue(['Smoke machine'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
