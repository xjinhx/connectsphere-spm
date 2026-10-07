import Link from 'next/link';
import { notFound } from 'next/navigation';
import { VenueBookingDecisionForm } from '@/components/venue-booking/VenueBookingDecisionForm';
import { describeTimeSlots } from '@/domain/event-request/policy';
import { TimeSlotEnum } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import { ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import type {
  DecidedVenueBookingRequestLine,
  VenueBookingDecision,
  VenueBookingRequestStatus,
} from '@/domain/venue-booking/schema';
import {
  describeAccessibilityForVenueStaff,
  describeApprovalConflict,
  describeAttendanceForVenueStaff,
  describeLayoutForVenueStaff,
} from '@/domain/venue-booking/policy';
import { findPendingLineConflicts, getBookingRequestRequirements, viewVenueBookingRequest } from '@/domain/venue-booking/service';
import { getVenue, listVenues } from '@/domain/venues/service';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-148 AC1 and AC5 — Venue Staff open a pending booking request and
 * approve or reject each line, a rejected line with a reason. Once decided,
 * each line shows who decided, when, and why if rejected.
 *
 * SCRUM-155 AC2 — a pending line that clashes with a confirmed booking or an
 * unavailable slot shows what it clashes with, and offers Reject only.
 *
 * SCRUM-150 AC1, AC2 — a rejected line may carry a suggested venue, date and
 * slots. It is shown under the line, and the event's coordinator gets a link to
 * the event's own page, where a new booking request is made. Nothing is booked
 * or requested by the suggestion itself (AC3).
 *
 * SCRUM-149 AC3 — the event's assigned coordinator opens the same page, read
 * only, and sees each rejected line's reason and the staff member who decided.
 * The decision form is for Venue Staff (venue_administration, the permission
 * the decision route asserts).
 *
 * SCRUM-143 AC1 — with the requested dates and slots listed by the decision
 * below, the event's reference and the requesting coordinator are shown.
 * SCRUM-143 AC2 — the event's attendance, layout and accessibility needs are
 * shown as recorded on the event; AC4 — one never recorded reads "Not
 * specified", not blank (policy.ts). AC3 was removed in Change Log CL-05.
 *
 * SCRUM-147's queue links Venue Staff here. SCRUM-144's list (backlog) will
 * link coordinators; until then they open it by its link.
 */

export const dynamic = 'force-dynamic';

const STATUS_LABELS: Record<VenueBookingRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  partially_approved: 'Partially Approved',
  rejected: 'Rejected',
};

function lineLabel(line: DecidedVenueBookingRequestLine): string {
  return `${formatSingaporeDate(line.date)} · ${describeTimeSlots(TimeSlotEnum.array().parse(line.timeSlots))}`;
}

export default async function VenueBookingRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  const { id } = await params;

  let request: VenueBookingDecision;
  try {
    request = await viewVenueBookingRequest(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Booking request</h1>
          <p className="mt-4 text-[var(--text-muted)]">
            This booking request is for Venue Staff and the event&apos;s coordinator.
          </p>
        </main>
      );
    }
    throw error;
  }
  const [venue, requirements] = await Promise.all([getVenue(request.venueId), getBookingRequestRequirements(request.id)]);
  const canDecide = request.status === 'pending' && isActionPermitted(actor.roles, 'venue_administration');
  const conflicts = canDecide ? await findPendingLineConflicts(request) : [];
  const venues = canDecide ? await listVenues() : [];
  const isCoordinator = request.coordinatorId !== null && request.coordinatorId === actor.userId;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Booking request</h1>
        <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium">
          {STATUS_LABELS[request.status]}
        </span>
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{venue.name}</p>

      {/* SCRUM-143 AC1: the event, its reference and who requested it. */}
      <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <dt className="font-medium text-[var(--text-muted)]">Event</dt>
        <dd>{requirements.eventName}</dd>
        <dt className="font-medium text-[var(--text-muted)]">Reference</dt>
        <dd className="font-mono">{requirements.eventReference}</dd>
        <dt className="font-medium text-[var(--text-muted)]">Requested by</dt>
        <dd>{requirements.requestedByName ?? 'Name not recorded'}</dd>
        <dt className="font-medium text-[var(--text-muted)]">Requested on</dt>
        <dd>{formatSingaporeDateTime(requirements.requestedAt)}</dd>
      </dl>

      {/* SCRUM-143 AC2 and AC4: what the event needs from the venue, as recorded on the event. */}
      <h2 className="mt-6 text-base font-semibold">Event requirements</h2>
      <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
        <dt className="font-medium text-[var(--text-muted)]">Expected attendance</dt>
        <dd>{describeAttendanceForVenueStaff(requirements.expectedAttendance)}</dd>
        <dt className="font-medium text-[var(--text-muted)]">Room layout</dt>
        <dd>{describeLayoutForVenueStaff(requirements.roomLayout)}</dd>
        <dt className="font-medium text-[var(--text-muted)]">Accessibility needs</dt>
        <dd className="whitespace-pre-line">{describeAccessibilityForVenueStaff(requirements)}</dd>
      </dl>

      {canDecide ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <VenueBookingDecisionForm
            requestId={request.id}
            venues={venues.map((venue) => ({ id: venue.id, name: venue.name }))}
            lines={request.lines.map((line) => {
              const clashes = conflicts.filter((conflict) => conflict.lineId === line.id);
              return {
                id: line.id,
                label: lineLabel(line),
                date: line.date,
                timeSlots: line.timeSlots,
                blockedReason: clashes.length > 0 ? clashes.map(describeApprovalConflict).join(' ') : undefined,
              };
            })}
          />
        </section>
      ) : (
        <ul className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {request.lines.map((line) => (
            <li key={line.id} className="border-b border-[var(--border)] p-4 text-sm last:border-b-0">
              <p className="font-medium">{lineLabel(line)}</p>
              {line.status === 'pending' ? (
                <p className="mt-1 text-[var(--text-muted)]">Awaiting a Venue Staff decision</p>
              ) : (
                <>
                  {/* SCRUM-148 AC1, SCRUM-149 AC3: the decider and the decision time. */}
                  <p className="mt-1">
                    {line.status === 'approved' ? 'Approved' : 'Rejected'} by{' '}
                    {line.decidedByName ?? 'Unnamed account'}
                    {line.decidedAt ? ` · ${formatSingaporeDateTime(line.decidedAt)}` : ''}
                  </p>
                  {/* SCRUM-148 AC5, SCRUM-149 AC3: each rejected line carries its reason. */}
                  {line.rejectionReason ? (
                    <p className="mt-1 text-[var(--text-muted)]">Reason: {line.rejectionReason}</p>
                  ) : null}
                  {/* SCRUM-150 AC1, AC2: what Venue Staff suggested instead, and for the coordinator a way to request it. */}
                  {line.suggestion ? (
                    <div className="mt-2 rounded-md border border-[var(--border)] px-3 py-2">
                      <p>
                        Suggested instead: {line.suggestion.venueName}, {formatSingaporeDate(line.suggestion.date)} ·{' '}
                        {describeTimeSlots(TimeSlotEnum.array().parse(line.suggestion.slots))}
                      </p>
                      {isCoordinator ? (
                        <Link
                          href={`/events/${request.eventRequestId}/review`}
                          className="mt-1 inline-block text-sm text-[var(--brand)] hover:underline"
                        >
                          Start a new booking request for this event
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
