import { EVENT_REQUEST_STATUS_LABELS, type EventRequestStatus } from '@/domain/event-request/schema';
import { ARRANGEMENTS, type Arrangement, type ArrangementNeeds } from './schema';

/**
 * SCRUM-100 — Record which arrangements are essential for an event.
 * Pure rules only; service.ts applies them.
 */

/**
 * AC1: the set can be recorded while the event is Approved or in Planning.
 * AC3: a Confirmed event refuses a change until it is returned to Planning,
 * and so does every other status (TC-100-04).
 *
 * Restated in SQL by record_essential_arrangements
 * (20261017084246_event_essential_arrangements.sql), which checks it again with
 * the event row locked; change one, change the other.
 */
export function canChangeEssentialArrangements(status: EventRequestStatus): boolean {
  return status === 'approved' || status === 'planning';
}

export const CONFIRMED_REFUSAL =
  'This event is Confirmed. Return it to Planning before changing its essential arrangements.';

/** Why a status refuses a change, or null when it allows one. */
export function essentialArrangementsRefusal(status: EventRequestStatus): string | null {
  if (canChangeEssentialArrangements(status)) return null;
  if (status === 'confirmed') return CONFIRMED_REFUSAL;
  return (
    'Essential arrangements can only be recorded while an event is Approved or in Planning. ' +
    `This event is ${EVENT_REQUEST_STATUS_LABELS[status]}.`
  );
}

/** Before anything is recorded, nothing is essential (AC2, TC-100-05). */
export const NO_ARRANGEMENTS_RECORDED: ArrangementNeeds = {
  venue: 'not_required',
  equipment: 'not_required',
  technicalSupport: 'not_required',
  registration: 'not_required',
};

/** The arrangements marked essential, in card order. */
export function essentialArrangementsIn(needs: ArrangementNeeds): Arrangement[] {
  return ARRANGEMENTS.filter((arrangement) => needs[arrangement] === 'essential');
}

/** AC2's wording, shown when no arrangement is marked essential. */
export const NO_OUTSTANDING_ESSENTIAL_ARRANGEMENTS = 'No outstanding essential arrangements.';
