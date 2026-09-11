import { eventRequestCoreSchema } from './schema';

/**
 * SCRUM-78 — State expected attendance.
 * Pure validation, no I/O. Reuses the shared schema's attendance rule so this
 * story and the base event-request story never define the rule twice.
 */
export function validateExpectedAttendance(value: unknown): number {
  return eventRequestCoreSchema.shape.expectedAttendance.parse(value);
}

/**
 * AC4 (US-5.1-TC04): attendance is a single event-level field.
 * This function exists so tests can assert the shape directly — if someone
 * later adds a duplicate `attendance` field inside venue requirements,
 * this check should be extended to guard against it once that shape exists.
 */
export function isAttendanceEventLevelOnly(eventRequest: Record<string, unknown>): boolean {
  const venueRequirements = eventRequest.venueRequirements as
    | Record<string, unknown>
    | undefined;
  return !venueRequirements || !('expectedAttendance' in venueRequirements);
}