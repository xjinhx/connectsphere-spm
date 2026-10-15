import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import { ValidationError } from '@/domain/shared/errors';

/**
 * Equipment catalogue business rules (SCRUM-240). Pure functions: no Supabase,
 * no Next.js.
 *
 * Single-field rules (a quantity is a whole number of at least zero, the four
 * operational statuses) live in schema.ts. This file holds who may do what,
 * and AC5's check that a requirement only names items the catalogue holds.
 */

// -----------------------------------------------------------------------------
// Permissions (AC3)
//
// Both read from the team's permission matrix (SCRUM-69,
// src/domain/identity/permissions.ts) instead of listing roles here, so there
// is one place that decides who may do what. These wrappers exist so pages can
// ask a readable question when deciding what to render; route handlers call
// assertPermission with the same action names.
// -----------------------------------------------------------------------------

/**
 * AC1, AC2, AC4: only Technical Support Staff add or change an item
 * (clarification #9, equipment is their responsibility).
 *
 * AC3 refuses roles other than Technical Support Staff, not accounts that hold
 * Technical Support as well as another role (TC-240-09): an account's actions
 * are the union across its roles (getPermittedActions), so a coordinator who
 * is also Technical Support is allowed.
 */
export function canManageEquipment(roles: Role[]): boolean {
  return isActionPermitted(roles, 'equipment_administration');
}

/**
 * AC5: a coordinator recording an equipment requirement has to see the
 * catalogue to choose from it, so reading it is a separate permission from
 * maintaining it. AC3 refuses adding and changing, not looking.
 *
 * Technical Support Staff maintain the catalogue, so they may always read it.
 */
export function canViewEquipmentCatalogue(roles: Role[]): boolean {
  return isActionPermitted(roles, 'equipment_catalogue_view') || canManageEquipment(roles);
}

// -----------------------------------------------------------------------------
// AC5: a requirement can only name items that exist in the catalogue
// -----------------------------------------------------------------------------

/**
 * The ids in `requested` that the catalogue does not hold, in the order given
 * and without repeats.
 *
 * This is the catalogue's half of AC5. The requirement itself is SCRUM-160's
 * story: it offers listEquipmentOptions() in its picker and calls
 * assertEquipmentInCatalogue (service.ts) before saving, so an id typed
 * straight at the API is refused as well as one that is not offered in the
 * list (TC-240-15).
 */
export function findUnknownEquipmentIds(
  catalogueIds: readonly string[],
  requested: readonly string[],
): string[] {
  const known = new Set(catalogueIds);
  return [...new Set(requested)].filter((id) => !known.has(id));
}

/** AC5: refuses the requirement, naming the ids the catalogue does not hold. */
export function assertEquipmentIdsKnown(catalogueIds: readonly string[], requested: readonly string[]): void {
  const unknown = findUnknownEquipmentIds(catalogueIds, requested);
  if (unknown.length > 0) {
    const message = 'Equipment must be chosen from the catalogue.';
    throw new ValidationError(message, {
      formErrors: [],
      fieldErrors: { equipmentId: [message] },
      unknownEquipmentIds: unknown,
    });
  }
}
