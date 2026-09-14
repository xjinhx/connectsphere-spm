import { ValidationError } from '@/domain/shared/errors';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import type { VenueLayoutInput } from './schema';

/**
 * Venue Catalogue business rules. Pure functions: no Supabase, no Next.js.
 *
 * Single-field rules (capacity is a positive whole number, at least one slot)
 * live in schema.ts. This file holds the rules that compare values against
 * each other, plus who may do what.
 */

// -----------------------------------------------------------------------------
// SCRUM-118: layout capacity versus venue maximum
// -----------------------------------------------------------------------------

/**
 * Returns the layouts whose capacity is above the venue's maximum.
 * Equal is allowed: 200 against a maximum of 200 passes (SCRUM-118 AC4),
 * 201 against 200 does not (SCRUM-118 AC3).
 */
export function findLayoutsOverMaxCapacity(maxCapacity: number, layouts: VenueLayoutInput[]): VenueLayoutInput[] {
  return layouts.filter((layout) => layout.capacity > maxCapacity);
}

/**
 * Throws if any layout capacity is above the venue maximum.
 *
 * Call this on create, and on update whenever either the maximum capacity or
 * the layouts change, using the values the venue will have AFTER the update.
 * That way lowering a venue from 200 to 150 is refused while a 200-seat layout
 * still exists.
 */
export function assertLayoutsWithinMaxCapacity(maxCapacity: number, layouts: VenueLayoutInput[]): void {
  const overCapacity = findLayoutsOverMaxCapacity(maxCapacity, layouts);
  if (overCapacity.length > 0) {
    throw new ValidationError('Layout capacity cannot exceed the venue maximum.', {
      maxCapacity,
      layouts: overCapacity,
    });
  }
}

// -----------------------------------------------------------------------------
// Permissions
//
// Both read from the team's permission matrix (SCRUM-69,
// src/domain/identity/permissions.ts) instead of listing roles here, so there
// is one place that decides who may do what. These wrappers exist so pages can
// ask a readable question when deciding what to render; route handlers call
// assertPermission with the same action names.
// -----------------------------------------------------------------------------

/** SCRUM-116, 117, 118, 120: only Venue Staff maintain the catalogue. */
export function canManageVenues(roles: Role[]): boolean {
  return isActionPermitted(roles, 'venue_administration');
}

/**
 * SCRUM-121: internal staff may browse the catalogue.
 * Event Organisers and Attendees are not given catalogue access in Release 1,
 * because the stories only name Coordinators and Venue Staff.
 */
export function canViewVenueCatalogue(roles: Role[]): boolean {
  return isActionPermitted(roles, 'venue_catalogue_view');
}
