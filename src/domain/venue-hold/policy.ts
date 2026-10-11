import { SINGAPORE_TIME_ZONE, formatSingaporeDate, isISODate } from '@/domain/shared/dates';
import { isActionPermitted } from '@/domain/identity/permissions';
import type { Role } from '@/domain/identity/roles';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { VenueCommitment } from '@/domain/availability/schema';
import { HOLDABLE_EVENT_STATUSES, type HoldState } from './schema';

/**
 * Venue hold rules (SCRUM-227). Pure functions: no Supabase, no Next.js.
 */

/** "As a Venue Staff member, I want to hold a venue slot": venue_administration, Venue Staff's in SCRUM-69's matrix. */
export function canManageHolds(roles: readonly Role[]): boolean {
  return isActionPermitted([...roles], 'venue_administration');
}

/**
 * Only an Approved event, or one in Planning, can be held: the same rule as a
 * booking request (canCreateBookingRequest, SCRUM-142 AC1 and AC2). A hold
 * keeps a venue while a booking is arranged, and nothing can be booked for an
 * event before it is approved.
 */
export function canBeHeld(status: EventRequestStatus | string): boolean {
  return (HOLDABLE_EVENT_STATUSES as readonly string[]).includes(status);
}

const SINGAPORE_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/**
 * AC1 and AC2: the expiry as an instant, if it is a real Singapore date and
 * time after `now`; null if it is missing, malformed or not in the future.
 * Equal to `now` is not in the future.
 */
export function futureExpiry(value: string | undefined, now: Date): Date | null {
  const match = value ? SINGAPORE_DATE_TIME.exec(value) : null;
  if (!match) return null;
  const [, date = '', hours = '', minutes = ''] = match;
  // isISODate refuses 2026-02-30, which Date would quietly roll into March.
  if (!isISODate(date) || Number(hours) > 23 || Number(minutes) > 59) return null;
  const instant = new Date(`${date}T${hours}:${minutes}:00+08:00`);
  return instant.getTime() > now.getTime() ? instant : null;
}

/** AC1, AC5, AC6: where a hold stands at `now`. Closed wins: a booked hold never lapses. */
export function holdState(hold: { status: string; expiresAt: string }, now: Date): HoldState {
  if (hold.status === 'closed') return 'closed';
  return Date.parse(hold.expiresAt) > now.getTime() ? 'active' : 'lapsed';
}

/** "13 Nov 2026 17:00", in Singapore time. */
export function formatExpiry(iso: string): string {
  const instant = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: SINGAPORE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: SINGAPORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
  return `${formatSingaporeDate(date)} ${time}`;
}

/**
 * AC3 and AC5: an event's own holds do not stand in its way. A hold keeps a
 * period for event A so that A can book it; when A requests the period, or
 * Venue Staff approve A's request, A's hold is not a clash (AC5: the request
 * is approved and the hold closes). Every other commitment is kept.
 *
 * For SCRUM-239's request and approval checks to apply to what
 * getVenueCommitments returns, with the event being requested or approved.
 */
export function withoutOwnHolds(
  commitments: readonly VenueCommitment[],
  eventRequestId: string,
): VenueCommitment[] {
  return commitments.filter((c) => !(c.kind === 'hold' && c.eventRequestId === eventRequestId));
}

/**
 * AC4: how a held period is named to Venue Staff when it blocks an approval
 * (they may see which event holds it, as SCRUM-155 AC1):
 * "10:00-12:00 on 20 Nov 2026 is held for EVT-2026-0101 (Tech Summit) until 13 Nov 2026 17:00."
 */
export function describeHeldPeriod(
  period: { date: string; start: string; end: string; expiresAt: string },
  event: { reference: string; name: string } | null,
): string {
  const when = `${period.start}-${period.end} on ${formatSingaporeDate(period.date)}`;
  const holder = event ? ` for ${event.reference} (${event.name})` : '';
  return `${when} is held${holder} until ${formatExpiry(period.expiresAt)}.`;
}

/**
 * Customer #41 (one active hold or booking per overlapping period): what a
 * hold that would overlap an existing commitment is refused with, naming each
 * one for Venue Staff.
 */
export function describeCommitmentForHold(
  commitment: VenueCommitment,
  event: { reference: string; name: string } | null,
): string {
  const when = `${commitment.start}-${commitment.end} on ${formatSingaporeDate(commitment.date)}`;
  const holder = event ? ` for ${event.reference} (${event.name})` : '';
  switch (commitment.kind) {
    case 'booking':
      return `${when} is booked${holder}.`;
    case 'hold':
      return commitment.expiresAt
        ? describeHeldPeriod({ ...commitment, expiresAt: commitment.expiresAt }, event)
        : `${when} is held${holder}.`;
    case 'unavailable':
      return `${when} is unavailable${commitment.reason ? `: ${commitment.reason}` : ''}.`;
  }
}
