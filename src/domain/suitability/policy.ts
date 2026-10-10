import { ROOM_LAYOUT_LABELS, RoomLayoutSchema, type ReferenceItem, type RoomLayout } from '@/domain/venues/schema';
import type { RequirementResult, Verdict } from './schema';

/**
 * Venue suitability rules (SCRUM-135, SCRUM-136). Pure functions: no
 * Supabase, no Next.js.
 */

/** What the check needs from the event (or, under SCRUM-136 AC5, from a booking request). */
export type SuitabilityNeeds = {
  expectedAttendance: number | null;
  /** Null: the event requires no specific layout (AC4). */
  roomLayout: RoomLayout | null;
};

/**
 * SCRUM-135: the event's accessibility needs as SCRUM-79 records them (or,
 * under SCRUM-135 AC4, a booking request's own).
 */
export type AccessibilityNeeds = {
  /** Null: not answered yet. False: none required. True: the features below. */
  accessibilityRequired: boolean | null;
  accessibilityFeatures: readonly ReferenceItem[];
};

/** Everything a check reads from the event: what SCRUM-135 AC3 compares to tell whether it has changed. */
export type CheckedNeeds = SuitabilityNeeds & { accessibility: AccessibilityNeeds };

/** What the check needs from the venue. */
export type VenueCapacities = {
  maxCapacity: number;
  layouts: readonly { layout: RoomLayout; capacity: number }[];
};

/** A layout as stored on the event, or null for "no specific layout" (and anything not a catalogue layout). */
export function toRoomLayout(value: string | null): RoomLayout | null {
  const parsed = RoomLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * SCRUM-136 AC5: a booking request's own attendance and layout are used
 * instead of the event's, where the request carries them. One space of a
 * multi-venue event is checked for what it will actually be used for (Week 7
 * change #3, SCRUM-230). A value the request leaves empty falls back to the
 * event's, as SCRUM-230 AC2 does.
 */
export function needsFor(event: SuitabilityNeeds, request?: Partial<SuitabilityNeeds> | null): SuitabilityNeeds {
  return {
    expectedAttendance: request?.expectedAttendance ?? event.expectedAttendance,
    roomLayout: request?.roomLayout ?? event.roomLayout,
  };
}

/**
 * SCRUM-135 AC4: a booking request's own accessibility needs are used instead
 * of the event's when the request answers the question, as needsFor does for
 * attendance and layout. A request that leaves it unanswered falls back to the
 * event's, as SCRUM-230 AC2 does.
 */
export function accessibilityNeedsFor(
  event: AccessibilityNeeds,
  request?: Partial<AccessibilityNeeds> | null,
): AccessibilityNeeds {
  if (request?.accessibilityRequired === undefined || request.accessibilityRequired === null) return event;
  return {
    accessibilityRequired: request.accessibilityRequired,
    accessibilityFeatures: request.accessibilityFeatures ?? [],
  };
}

/**
 * SCRUM-136: is the venue big enough for the expected attendance?
 *
 * AC1: attendance above the capacity for the required layout is not met, and
 *      the shortfall is stated (150 against 120 is short by 30).
 * AC2: attendance equal to that capacity is met: 100 against 100 raises nothing.
 * AC3: no expected attendance recorded is unverified, naming the attendance.
 * AC4: when the event requires no specific layout, the venue's maximum
 *      capacity is the one compared.
 *
 * A required layout the venue has no capacity recorded for cannot be verified
 * either: there is no capacity to compare against. That is a venue attribute
 * not recorded, so "suitable with concerns" (SCRUM-135 AC1). Whether such a
 * venue is unsuitable because it lacks the layout is SCRUM-137's rule (AC2),
 * not this story's.
 */
export function capacityRequirement(needs: SuitabilityNeeds, venue: VenueCapacities): RequirementResult {
  const layoutName = needs.roomLayout ? ROOM_LAYOUT_LABELS[needs.roomLayout] : null;
  // AC4: no specific layout, so the maximum capacity; otherwise the layout's own.
  const capacity = needs.roomLayout
    ? venue.layouts.find((entry) => entry.layout === needs.roomLayout)?.capacity
    : venue.maxCapacity;
  const capacityName = layoutName ? `${layoutName} capacity` : 'maximum capacity';
  const attendance = needs.expectedAttendance;

  const result = {
    requirement: 'capacity' as const,
    label: 'Capacity',
    eventValue: attendance === null ? 'Not recorded' : `${attendance} expected`,
    venueValue: capacity === undefined ? `No ${layoutName} capacity recorded` : `${capacity} (${capacityName})`,
  };

  if (attendance === null) {
    return { ...result, outcome: 'unverified', detail: 'Expected attendance is not recorded.', shortfall: null };
  }
  if (capacity === undefined) {
    return {
      ...result,
      outcome: 'unverified',
      detail: `The venue has no capacity recorded for the ${layoutName} layout.`,
      shortfall: null,
    };
  }
  if (attendance > capacity) {
    const shortfall = attendance - capacity;
    return {
      ...result,
      outcome: 'not_met',
      detail: `Short by ${shortfall}: ${attendance} expected against a ${capacityName} of ${capacity}.`,
      shortfall,
    };
  }
  return { ...result, outcome: 'met', detail: null, shortfall: null };
}

/**
 * Exactly one verdict from every requirement checked (SCRUM-135 AC1, which
 * SCRUM-136's AC1 and AC3 apply): a breach makes it not suitable, even when
 * something else is also unrecorded; otherwise anything unrecorded makes it
 * suitable with concerns; otherwise it is suitable.
 */
export function verdictOf(results: readonly RequirementResult[]): Verdict {
  if (results.some((result) => result.outcome === 'not_met')) return 'not_suitable';
  if (results.some((result) => result.outcome === 'unverified')) return 'suitable_with_concerns';
  return 'suitable';
}

/**
 * SCRUM-135 AC2: what is listed when the verdict is not suitable: every
 * requirement that was not met, and every one that could not be verified
 * because something is unrecorded (the reason for "with concerns"), each with
 * the event's and the venue's values. A suitable verdict lists nothing.
 */
export function unmetRequirements(results: readonly RequirementResult[]): RequirementResult[] {
  return results.filter((result) => result.outcome !== 'met');
}

/**
 * SCRUM-135 AC3: whether the event's requirements are what they were when a
 * check was run. Only what the check reads is compared, so editing the event's
 * name or description does not make a stored check out of date.
 */
export function sameNeeds(a: CheckedNeeds, b: CheckedNeeds): boolean {
  const featureIds = (needs: AccessibilityNeeds) =>
    needs.accessibilityFeatures.map((feature) => feature.id).sort().join();
  return (
    a.expectedAttendance === b.expectedAttendance &&
    a.roomLayout === b.roomLayout &&
    a.accessibility.accessibilityRequired === b.accessibility.accessibilityRequired &&
    featureIds(a.accessibility) === featureIds(b.accessibility)
  );
}

// -----------------------------------------------------------------------------
// SCRUM-137's accessibility rule, stood in for so SCRUM-135 can be tested
// -----------------------------------------------------------------------------

/** "Hearing loop, Step-free access", or what to say when the list is empty. */
function featureNames(features: readonly ReferenceItem[], none: string): string {
  return features.length === 0 ? none : features.map((feature) => feature.name).join(', ');
}

/**
 * DUMMY(SCRUM-137) D-17: SCRUM-137 owns the accessibility rule (its AC3 and
 * AC4) and is in no sprint yet. This is the minimum honest version, so
 * SCRUM-135 can be tested with more than one requirement: a verdict that
 * combines them (AC1), and each one not met listed side by side (AC2).
 *
 * - Accessibility not answered on the event: unverified (an event requirement
 *   unrecorded, so "suitable with concerns").
 * - None required: met.
 * - Required features the venue does not record: not met, each named.
 * - Required, but the venue records no accessibility features at all:
 *   unverified. SCRUM-117 stores the venue's features as a list, which cannot
 *   tell "has none" from "never recorded", so the empty list is read as not
 *   recorded (a venue attribute unrecorded, SCRUM-135 AC1).
 * - Required with no feature named (notes only): unverified, there is nothing
 *   to compare.
 *
 * Layouts, facilities and operating hours (SCRUM-137 AC1, AC2, AC5 to AC7) are
 * not checked. See docs/dummies.md, D-17, for how SCRUM-137 replaces this.
 */
export function accessibilityRequirement(
  needs: AccessibilityNeeds,
  venueFeatures: readonly ReferenceItem[],
): RequirementResult {
  const result = {
    requirement: 'accessibility' as const,
    label: 'Accessibility',
    eventValue:
      needs.accessibilityRequired === null
        ? 'Not recorded'
        : needs.accessibilityRequired
          ? featureNames(needs.accessibilityFeatures, 'Required (no feature named)')
          : 'None required',
    venueValue: featureNames(venueFeatures, 'None recorded'),
    shortfall: null,
  };

  if (needs.accessibilityRequired === null) {
    return { ...result, outcome: 'unverified', detail: 'Accessibility needs are not recorded.' };
  }
  if (!needs.accessibilityRequired) {
    return { ...result, outcome: 'met', detail: null };
  }
  if (needs.accessibilityFeatures.length === 0) {
    return { ...result, outcome: 'unverified', detail: 'Accessibility is required, but no feature is named to check.' };
  }
  if (venueFeatures.length === 0) {
    return { ...result, outcome: 'unverified', detail: 'The venue has no accessibility features recorded.' };
  }
  const recorded = new Set(venueFeatures.map((feature) => feature.id));
  const missing = needs.accessibilityFeatures.filter((feature) => !recorded.has(feature.id));
  if (missing.length > 0) {
    return { ...result, outcome: 'not_met', detail: `Missing: ${featureNames(missing, '')}.` };
  }
  return { ...result, outcome: 'met', detail: null };
}
