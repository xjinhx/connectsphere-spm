import { notFound } from 'next/navigation';
import { VenueBookingDecisionForm } from '@/components/venue-booking/VenueBookingDecisionForm';
import { describeTimeSlots } from '@/domain/event-request/policy';
import { TimeSlotEnum } from '@/domain/event-request/schema';
import { isActionPermitted } from '@/domain/identity/permissions';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import { NotFoundError } from '@/domain/shared/errors';
import type {
  DecidedVenueBookingRequestLine,
  VenueBookingDecision,
  VenueBookingRequestStatus,
} from '@/domain/venue-booking/schema';
import {
  describeAccessibilityForVenueStaff,
  describeAttendanceForVenueStaff,
  describeLayoutForVenueStaff,
} from '@/domain/venue-booking/policy';
import { getBookingRequestRequirements, getVenueBookingDecision } from '@/domain/venue-booking/service';
import { getVenue } from '@/domain/venues/service';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-148 AC1 and AC5 — Venue Staff open a pending booking request and
 * approve or reject each line, a rejected line with a reason. Once decided,
 * each line shows who decided, when, and why if rejected.
 *
 * Only the decision lives here. The event's details are SCRUM-143's (below),
 * and SCRUM-147's queue links here.
 *
 * SCRUM-143 AC1 — with the requested dates and slots listed by the decision
 * below, the event's reference and the requesting coordinator are shown.
 * SCRUM-143 AC2 — the event's attendance, layout and accessibility needs are
 * shown as recorded on the event; AC4 — one never recorded reads "Not
 * specified", not blank (policy.ts). AC3 was removed in Change Log CL-05.
 *
 * Needs venue_administration, the same permission the decision route asserts.
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
  if (!isActionPermitted(actor.roles, 'venue_administration')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Booking request</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Venue Staff. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const { id } = await params;

  let request: VenueBookingDecision;
  try {
    request = await getVenueBookingDecision(id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }
  const [venue, requirements] = await Promise.all([getVenue(request.venueId), getBookingRequestRequirements(request.id)]);

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

      {request.status === 'pending' ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <VenueBookingDecisionForm
            requestId={request.id}
            lines={request.lines.map((line) => ({ id: line.id, label: lineLabel(line) }))}
          />
        </section>
      ) : (
        <ul className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {request.lines.map((line) => (
            <li key={line.id} className="border-b border-[var(--border)] p-4 text-sm last:border-b-0">
              <p className="font-medium">{lineLabel(line)}</p>
              {/* AC1: the decider and the decision time, recorded against the line. */}
              <p className="mt-1">
                {line.status === 'approved' ? 'Approved' : 'Rejected'} by {line.decidedByName ?? 'Unnamed account'}
                {line.decidedAt ? ` · ${formatSingaporeDateTime(line.decidedAt)}` : ''}
              </p>
              {/* AC5: each rejected line carries its reason. */}
              {line.rejectionReason ? (
                <p className="mt-1 text-[var(--text-muted)]">Reason: {line.rejectionReason}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
