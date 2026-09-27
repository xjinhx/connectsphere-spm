import {
  fetchUnavailableSlotsOn,
  fetchUpcomingUnavailableSlots,
  insertUnavailableSlots,
} from '@/lib/supabase/availability';
import { ConflictError, ValidationError, isUniqueViolation } from '@/domain/shared/errors';
import { formatSingaporeDate, todayInSingapore, type ISODate } from '@/domain/shared/dates';
import { getVenue } from '@/domain/venues/service';
import { OPERATING_SLOTS, type OperatingSlot } from '@/domain/venues/schema';
import { findNonOperatingSlots } from './policy';
import {
  MarkSlotsUnavailableInputSchema,
  SLOT_NAMES,
  UnavailableSlotSchema,
  type UnavailableSlot,
} from './schema';

/**
 * Venue availability service (EP-13).
 *
 * SCRUM-151 Withdraw venue availability when circumstances change
 *
 * Orchestration only, like domain/venues/service.ts: every query lives in
 * src/lib/supabase/availability.ts, the rule comparing slots lives in
 * policy.ts, and single-field rules live in schema.ts.
 */

type UnavailableSlotRow = {
  id: string;
  venue_id: string;
  slot_date: string;
  slot: string;
  reason: string;
  recorded_at: string;
};

function toUnavailableSlot(row: UnavailableSlotRow): UnavailableSlot {
  return UnavailableSlotSchema.parse({
    id: row.id,
    venueId: row.venue_id,
    date: row.slot_date,
    slot: row.slot,
    reason: row.reason,
    recordedAt: row.recorded_at,
  });
}

/** Soonest date first, and within a day AM, PM, Night: the order the day runs in. */
function byDateThenSlot(a: UnavailableSlot, b: UnavailableSlot): number {
  return a.date.localeCompare(b.date) || OPERATING_SLOTS.indexOf(a.slot) - OPERATING_SLOTS.indexOf(b.slot);
}

/** "AM", "AM and PM", "AM, PM and Night". */
function slotNames(slots: readonly OperatingSlot[]): string {
  const names = slots.map((slot) => SLOT_NAMES[slot]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// -----------------------------------------------------------------------------
// SCRUM-151 AC1: record slots as unavailable
// -----------------------------------------------------------------------------

/**
 * SCRUM-151 AC1: record the chosen slots of one venue on one date as
 * unavailable, each with the reason and who recorded it.
 *
 * All or nothing: the slots go in as one insert, so if one of them is already
 * unavailable none is saved, and the message names the ones that were.
 *
 * Who may do this is checked by the route: venue_administration, which is
 * Venue Staff's in SCRUM-69's matrix (customer clarification #54 makes
 * availability their job). The recorder is the signed-in account passed in by
 * the route, never an id from the request body.
 */
export async function markSlotsUnavailable(
  venueId: string,
  input: unknown,
  actorId: string,
): Promise<UnavailableSlot[]> {
  const parsed = MarkSlotsUnavailableInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The slots could not be marked unavailable.',
      parsed.error.flatten(),
    );
  }
  const { date, slots, reason } = parsed.data;

  // Throws NotFoundError for a venue that does not exist or a malformed id.
  const venue = await getVenue(venueId);

  const notOperating = findNonOperatingSlots(slots, venue.operatingSlots);
  if (notOperating.length > 0) {
    throw new ValidationError(
      `${venue.name} does not operate in the ${slotNames(notOperating)} slot${notOperating.length > 1 ? 's' : ''}, so there is nothing to withdraw.`,
      { notOperating },
    );
  }

  const { data, error } = await insertUnavailableSlots(
    slots.map((slot) => ({ venueId: venue.id, date, slot, reason, recordedBy: actorId })),
  );

  if (error) {
    if (isUniqueViolation(error)) {
      throw await alreadyUnavailableError(venue.id, date, slots);
    }
    throw new ValidationError('The slots could not be marked unavailable.', error.message);
  }

  return (data ?? []).map(toUnavailableSlot).sort(byDateThenSlot);
}

/** The 409 for a save that included a slot already unavailable. It names which. */
async function alreadyUnavailableError(
  venueId: string,
  date: ISODate,
  slots: readonly OperatingSlot[],
): Promise<ConflictError> {
  const existing = await findUnavailableSlots(venueId, date, slots);
  const names = slotNames(existing.map((entry) => entry.slot));
  const message =
    existing.length === 0
      ? 'One of those slots is already unavailable. Nothing was saved.'
      : `${names} on ${formatSingaporeDate(date)} ${existing.length === 1 ? 'is' : 'are'} already unavailable. Nothing was saved.`;
  return new ConflictError(message, { reason: 'already_unavailable', alreadyUnavailable: existing });
}

// -----------------------------------------------------------------------------
// SCRUM-151 AC1: "no longer offered for new bookings"
// -----------------------------------------------------------------------------

/**
 * The one place that answers "is this slot unavailable, and why?". Returns
 * the slots among `slots` (all three if left out) that are unavailable at the
 * venue on `date`, each with its recorded reason. An empty list means none of
 * them has been withdrawn.
 *
 * For the stories that offer or accept slots, so the rule lives in one place:
 * SCRUM-154 AC4-5 (refuse a booking request), SCRUM-155 AC5 (refuse an
 * approval and show the reason), SCRUM-128 AC4 (leave the venue out of a
 * search) and SCRUM-123 AC7 (show the slot as Blocked with its reason).
 * Tested directly for now; re-tested end to end once those stories call it.
 */
export async function findUnavailableSlots(
  venueId: string,
  date: ISODate,
  slots: readonly OperatingSlot[] = OPERATING_SLOTS,
): Promise<UnavailableSlot[]> {
  const { data, error } = await fetchUnavailableSlotsOn(venueId, date, slots);
  if (error || !data) {
    throw new ValidationError("Could not check the venue's availability.", error?.message);
  }
  return data.map(toUnavailableSlot).sort(byDateThenSlot);
}

/**
 * The venue page's list: this venue's unavailable slots from today on,
 * soonest first. "Today" is Singapore's date, not the server's UTC one.
 */
export async function listUpcomingUnavailableSlots(
  venueId: string,
  today: ISODate = todayInSingapore(),
): Promise<UnavailableSlot[]> {
  const { data, error } = await fetchUpcomingUnavailableSlots(venueId, today);
  if (error || !data) {
    throw new ValidationError("Could not load the venue's unavailable slots.", error?.message);
  }
  return data.map(toUnavailableSlot).sort(byDateThenSlot);
}
