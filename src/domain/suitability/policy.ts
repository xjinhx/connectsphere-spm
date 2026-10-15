import { ROOM_LAYOUT_LABELS, RoomLayoutSchema, type RoomLayout } from '@/domain/venues/schema';
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
 * check was run. Only what the check reads is compared (attendance and
 * layout), so editing the event's name, description or accessibility needs
 * does not make a stored check out of date.
 */
export function sameNeeds(a: SuitabilityNeeds, b: SuitabilityNeeds): boolean {
  return a.expectedAttendance === b.expectedAttendance && a.roomLayout === b.roomLayout;
}
