import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * SCRUM-240 Maintain the equipment catalogue (Jira, authoritative). Test case
 * IDs are the Sprint 3 sheet's SCRUM-240 tab (TC-240-nn).
 *
 * The service decides everything - what is valid, which columns a change
 * touches, whether a requirement's equipment exists - before it writes, so the
 * data layer is replaced with spies and nothing here needs a database.
 *
 * What the mocks cannot prove is that the row really lands in Postgres with
 * operational_status 'available' and a quantity of at least zero. That is
 * covered by the migration's own column default and CHECK constraints
 * (20261013093825_create_equipment_catalogue.sql) and by the manual run
 * against the stored row, and it is noted in each test case's Remarks.
 */

vi.mock('@/lib/supabase/equipment', () => ({
  fetchEquipment: vi.fn(),
  fetchEquipmentById: vi.fn(),
  fetchEquipmentIdsIn: vi.fn(),
  insertEquipment: vi.fn(),
  updateEquipmentRow: vi.fn(),
}));

import {
  fetchEquipment,
  fetchEquipmentIdsIn,
  insertEquipment,
  updateEquipmentRow,
} from '@/lib/supabase/equipment';
import {
  assertEquipmentInCatalogue,
  createEquipmentItem,
  listEquipment,
  listEquipmentOptions,
  updateEquipmentItem,
} from '@/domain/equipment/service';
import { DomainError } from '@/domain/shared/errors';

const TECH_SUPPORT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EQ_1 = '11111111-1111-4111-8111-111111111111';
const EQ_2 = '22222222-2222-4222-8222-222222222222';
const NOT_IN_CATALOGUE = '44444444-4444-4444-8444-444444444444';

/** EQ-1 as the catalogue holds it: AV, quantity 4, Bugis store room, Available. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: EQ_1,
    name: 'Projector P-100',
    category: 'av',
    quantity: 4,
    current_location: 'Bugis store room',
    operational_status: 'available',
    created_at: '2026-10-13T01:00:00.000Z',
    updated_at: '2026-10-13T01:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------------
// AC1 — the item is saved and listed in the catalogue
// -----------------------------------------------------------------------------

describe('createEquipmentItem: SCRUM-240 AC1', () => {
  it('TC-240-01 saves the name, category, quantity and location, and returns the stored item', async () => {
    vi.mocked(insertEquipment).mockResolvedValue({ data: row(), error: null } as never);

    const item = await createEquipmentItem(
      { name: 'Projector P-100', category: 'av', quantity: 4, currentLocation: 'Bugis store room' },
      TECH_SUPPORT_ID,
    );

    expect(insertEquipment).toHaveBeenCalledWith({
      name: 'Projector P-100',
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
      createdBy: TECH_SUPPORT_ID,
    });
    expect(item).toMatchObject({
      id: EQ_1,
      name: 'Projector P-100',
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
    });
  });

  it('TC-240-01 records the signed-in account, not an id sent in the body', async () => {
    vi.mocked(insertEquipment).mockResolvedValue({ data: row(), error: null } as never);

    await createEquipmentItem(
      {
        name: 'Projector P-100',
        category: 'av',
        quantity: 4,
        currentLocation: 'Bugis store room',
        createdBy: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      TECH_SUPPORT_ID,
    );

    expect(insertEquipment).toHaveBeenCalledWith(expect.objectContaining({ createdBy: TECH_SUPPORT_ID }));
  });

  it('TC-240-02 saves nothing when a field is missing', async () => {
    await expect(
      createEquipmentItem({ name: '', category: '', quantity: 4, currentLocation: '' }, TECH_SUPPORT_ID),
    ).rejects.toThrow(DomainError);
    expect(insertEquipment).not.toHaveBeenCalled();
  });

  it('TC-240-03 sends no operational status, so the column default makes a new item Available', async () => {
    vi.mocked(insertEquipment).mockResolvedValue({ data: row(), error: null } as never);

    const item = await createEquipmentItem(
      { name: 'Flipchart stand FS-9', category: 'furniture', quantity: 6, currentLocation: 'Jurong East store room' },
      TECH_SUPPORT_ID,
    );

    expect(insertEquipment).toHaveBeenCalledWith(expect.not.objectContaining({ operationalStatus: expect.anything() }));
    expect(item.operationalStatus).toBe('available');
  });

  it('TC-240-10 saves nothing for a quantity of -1', async () => {
    await expect(
      createEquipmentItem(
        { name: 'Wireless mic WM-3', category: 'av', quantity: -1, currentLocation: 'Bugis store room' },
        TECH_SUPPORT_ID,
      ),
    ).rejects.toThrow(DomainError);
    expect(insertEquipment).not.toHaveBeenCalled();
  });

  it('TC-240-10 saves a quantity of 0', async () => {
    vi.mocked(insertEquipment).mockResolvedValue({ data: row({ quantity: 0 }), error: null } as never);

    const item = await createEquipmentItem(
      { name: 'Wireless mic WM-3', category: 'av', quantity: 0, currentLocation: 'Bugis store room' },
      TECH_SUPPORT_ID,
    );

    expect(insertEquipment).toHaveBeenCalledWith(expect.objectContaining({ quantity: 0 }));
    expect(item.quantity).toBe(0);
  });
});

describe('listEquipment: SCRUM-240 AC1 and AC2', () => {
  it('TC-240-01 lists each item with its four fields and its operational status', async () => {
    vi.mocked(fetchEquipment).mockResolvedValue({
      data: [row(), row({ id: EQ_2, name: 'Lectern LC-1', category: 'furniture', operational_status: 'damaged' })],
      error: null,
    } as never);

    const items = await listEquipment();

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      name: 'Projector P-100',
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
      operationalStatus: 'available',
    });
    expect(items[1]).toMatchObject({ name: 'Lectern LC-1', operationalStatus: 'damaged' });
  });

  it('TC-240-04 reads the status from the stored row, not from a cached list', async () => {
    vi.mocked(fetchEquipment).mockResolvedValue({
      data: [row({ operational_status: 'under_maintenance' })],
      error: null,
    } as never);

    const [item] = await listEquipment();
    expect(item?.operationalStatus).toBe('under_maintenance');
    expect(fetchEquipment).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// AC2, AC4 — changing an item
// -----------------------------------------------------------------------------

describe('updateEquipmentItem: SCRUM-240 AC2', () => {
  it.each([
    ['unavailable'],
    ['damaged'],
    ['under_maintenance'],
    ['available'],
  ])('TC-240-04 saves the status %s and shows it in the catalogue', async (status) => {
    vi.mocked(updateEquipmentRow).mockResolvedValue({ data: row({ operational_status: status }), error: null } as never);

    const item = await updateEquipmentItem(EQ_1, { operationalStatus: status });

    expect(updateEquipmentRow).toHaveBeenCalledWith(EQ_1, { operational_status: status });
    expect(item.operationalStatus).toBe(status);
  });

  it('TC-240-05 refuses a status outside the four, leaving the stored row alone', async () => {
    await expect(updateEquipmentItem(EQ_1, { operationalStatus: 'Broken' })).rejects.toThrow(DomainError);
    expect(updateEquipmentRow).not.toHaveBeenCalled();
  });

  it('TC-240-06 sends only the status column, so the quantity and location are left alone', async () => {
    vi.mocked(updateEquipmentRow).mockResolvedValue({ data: row({ operational_status: 'damaged' }), error: null } as never);

    const item = await updateEquipmentItem(EQ_1, { operationalStatus: 'damaged' });

    expect(updateEquipmentRow).toHaveBeenCalledWith(EQ_1, { operational_status: 'damaged' });
    expect(item).toMatchObject({
      name: 'Projector P-100',
      category: 'av',
      quantity: 4,
      currentLocation: 'Bugis store room',
      operationalStatus: 'damaged',
    });
  });

  it('TC-240-12 refuses a quantity of -2 on an edit, leaving the stored quantity alone', async () => {
    await expect(updateEquipmentItem(EQ_1, { quantity: -2 })).rejects.toThrow(DomainError);
    expect(updateEquipmentRow).not.toHaveBeenCalled();
  });

  it('TC-240-13 saves a quantity of 6', async () => {
    vi.mocked(updateEquipmentRow).mockResolvedValue({ data: row({ quantity: 6 }), error: null } as never);

    const item = await updateEquipmentItem(EQ_1, { quantity: 6 });

    expect(updateEquipmentRow).toHaveBeenCalledWith(EQ_1, { quantity: 6 });
    expect(item.quantity).toBe(6);
  });

  it('is a 404 for an id the catalogue does not hold', async () => {
    vi.mocked(updateEquipmentRow).mockResolvedValue({ data: null, error: null } as never);

    await expect(updateEquipmentItem(NOT_IN_CATALOGUE, { quantity: 6 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('is a 404 for an id that is not an id at all, without touching the table', async () => {
    await expect(updateEquipmentItem('not-an-id', { quantity: 6 })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(updateEquipmentRow).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// AC5 — the list a coordinator chooses from, and the guard behind it
// -----------------------------------------------------------------------------

describe('listEquipmentOptions: SCRUM-240 AC5', () => {
  it('TC-240-16 offers every catalogue item, whatever its operational status', async () => {
    vi.mocked(fetchEquipment).mockResolvedValue({
      data: [
        row({ id: EQ_1, operational_status: 'available' }),
        row({ id: EQ_2, name: 'Lectern LC-1', operational_status: 'damaged' }),
        row({ id: NOT_IN_CATALOGUE, name: 'Stage riser SR-2', operational_status: 'under_maintenance' }),
      ],
      error: null,
    } as never);

    const options = await listEquipmentOptions();

    expect(options.map((option) => option.operationalStatus)).toEqual([
      'available',
      'damaged',
      'under_maintenance',
    ]);
  });
});

describe('assertEquipmentInCatalogue: SCRUM-240 AC5', () => {
  it('TC-240-14 lets a requirement that names a catalogue item through', async () => {
    vi.mocked(fetchEquipmentIdsIn).mockResolvedValue({ data: [{ id: EQ_1 }], error: null } as never);

    await expect(assertEquipmentInCatalogue([EQ_1])).resolves.toBeUndefined();
  });

  it('TC-240-15 refuses an equipment id the catalogue does not hold', async () => {
    vi.mocked(fetchEquipmentIdsIn).mockResolvedValue({ data: [], error: null } as never);

    await expect(assertEquipmentInCatalogue([NOT_IN_CATALOGUE])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('TC-240-15 refuses an id that is not an id at all, without asking the table about it', async () => {
    vi.mocked(fetchEquipmentIdsIn).mockResolvedValue({ data: [], error: null } as never);

    await expect(assertEquipmentInCatalogue(['Smoke machine'])).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(fetchEquipmentIdsIn).toHaveBeenCalledWith([]);
  });

  it('asks nothing when a requirement names no equipment at all', async () => {
    await expect(assertEquipmentInCatalogue([])).resolves.toBeUndefined();
    expect(fetchEquipmentIdsIn).not.toHaveBeenCalled();
  });
});
