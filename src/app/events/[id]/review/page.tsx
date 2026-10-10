import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApproveRequestButton } from '@/components/event-request/ApproveRequestButton';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { ClarificationRounds } from '@/components/event-request/ClarificationRounds';
import { RejectRequestForm } from '@/components/event-request/RejectRequestForm';
import { RequestClarificationForm } from '@/components/event-request/RequestClarificationForm';
import { AffectedBookingsNotice } from '@/components/venue/AffectedBookingsNotice';
import { listAffectedBookings } from '@/domain/availability/service';
import { RequestVenueBookingForm } from '@/components/event-request/RequestVenueBookingForm';
import { EventVenueBookings } from '@/components/venue-booking/EventVenueBookings';
import { canCreateBookingRequest } from '@/domain/venue-booking/policy';
import { listEventVenueBookings } from '@/domain/venue-booking/service';
import { listVenues } from '@/domain/venues/service';
import {
  describeAccessibility,
  describeEquipment,
  describePreferredLocation,
  describeRegistration,
  describeRoomLayout,
  describeTechnicalSupport,
  describeTimeSlots,
} from '@/domain/event-request/policy';
import {
  getClarificationExchange,
  type ClarificationExchange,
} from '@/domain/clarification/service';
import { getReviewDetail, type ReviewDetail } from '@/domain/review/service';
import { canBeApproved, canBeRejected, canRequestClarification } from '@/domain/review/policy';
import { ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import { isActionPermitted } from '@/domain/identity/permissions';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';

/**
 * US-7.1 AC2 (`ConnectSphere_Test_Cases_v3.xlsx`, US-7.1-TC02) — open a
 * queued request from the Coordinator's assigned-events queue and see every
 * field the Organiser submitted. The queue itself is SCRUM-88
 * (src/app/assigned-events/page.tsx); this is the "open it" page that
 * page's own comment left for this story to build.
 *
 * Attachments (also named in TC02) are not shown: no attachment feature
 * exists anywhere in this codebase yet (not in CLAUDE.md's current-sprint
 * scope), so this shows everything that does exist and says so, rather than
 * inventing a feature to satisfy one clause of the test case.
 */

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

export default async function ReviewEventRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getCurrentActor();
  // The same permission the API route asserts, so the page and the route can
  // never disagree about who may review.
  if (!isActionPermitted(actor.roles, 'event_request_review')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Review request</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Event Coordinators. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const { id } = await params;

  let request: ReviewDetail;
  let exchange: ClarificationExchange;
  try {
    request = await getReviewDetail(id, actor.userId);
    // SCRUM-91 AC2/AC3. Read after getReviewDetail, never before: that call is
    // what refuses a request assigned to another coordinator (SCRUM-89 AC3), and
    // the exchange must not be read for someone who is not allowed to see it.
    //
    // Inside the same try for a reason: it does its own read of the same row, so
    // an Event Operations Manager reassigning the event in the gap between the
    // two reads makes this one refuse where the first allowed. Outside the try
    // that refusal was uncaught and took the whole page down, instead of showing
    // the "assigned to another Event Coordinator" message below - which is
    // exactly what that situation should say.
    exchange = await getClarificationExchange(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    // AC3 — assigned to another Coordinator. Shown as a refusal rather than a
    // crash, and nothing about the request is rendered.
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <Link href="/assigned-events" className="text-sm text-[var(--brand)] hover:underline">
            ← Assigned events
          </Link>
          <h1 className="mt-4 text-2xl font-semibold">Review request</h1>
          <p className="mt-4 text-[var(--text-muted)]">
            This request is assigned to another Event Coordinator, so you cannot review it.
          </p>
        </main>
      );
    }
    throw error;
  }

  // SCRUM-151 AC3. Read only now, after getReviewDetail above has refused
  // anyone the request is not theirs to see.
  const affectedBookings = await listAffectedBookings(request.id);
  // SCRUM-231 AC1-AC3, read for the same reason after getReviewDetail.
  const venueBookings = await listEventVenueBookings(request.id, actor.userId);

  // SCRUM-142 AC1/AC2 — a venue can only be requested once the event is
  // Approved or in Planning. Fetched only when
  // the section will actually render, the same reasoning as gating every
  // other action below on its own policy function first.
  const venues = canCreateBookingRequest(request.status) ? await listVenues() : [];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/assigned-events" className="text-sm text-[var(--brand)] hover:underline">
        ← Assigned events
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{request.name}</h1>
        <EventRequestStatusBadge status={request.status} />
      </div>
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{request.reference}</p>

      {/* SCRUM-151 AC3: a confirmed booking on a slot Venue Staff have since
          made unavailable, listed until it is released or replaced. First on
          the page because it needs the coordinator to act. */}
      <AffectedBookingsNotice bookings={affectedBookings} />

      {/* US-7.2 AC1/AC3 — a clarification already raised on this request.
          Status-aware wording, same reasoning as the Organiser's own page
          (src/app/events/[id]/page.tsx): once the request is resubmitted the
          note stays visible (AC3) but should no longer read as outstanding -
          confirmed missing here in a manual walkthrough (2026-09-16). */}
      {request.clarificationNote ? (
        <div className="mt-4 rounded-md border border-[var(--warning)] bg-amber-50 px-3 py-2 text-sm">
          <p className="font-medium text-[var(--warning)]">
            {request.status === 'clarification_requested'
              ? 'Clarification requested'
              : 'Clarification was requested earlier'}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{request.clarificationNote}</p>
          {request.clarificationRequestedAt ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Requested {formatSingaporeDateTime(request.clarificationRequestedAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* SCRUM-91 AC2/AC3 — "when the coordinator opens the request, the
          original clarification note, my response and my amended values are all
          retained", and "both rounds are listed in order". This is the page the
          card means by "the coordinator opens it".

          It sits below the box above rather than replacing it: that box is
          SCRUM-90's, it says what is outstanding right now, and this is the
          history behind it. The amended values are the fields listed under it,
          which are read from the request itself. */}
      <ClarificationRounds rounds={exchange.rounds} />

      <dl className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Purpose" value={request.purpose ?? 'Not provided'} />
        <Row label="Description" value={request.description ?? 'Not provided'} />
        <Row
          label="Proposed date"
          value={request.proposedDate ? formatSingaporeDate(request.proposedDate) : 'Not provided'}
        />
        <Row label="Time slots" value={describeTimeSlots(request.timeSlots)} />
        {/* SCRUM-78. Confirmed missing here in a manual walkthrough
            (2026-09-16) - the API (getReviewDetail) already returned it
            correctly, this row was never added. */}
        <Row
          label="Expected attendance"
          value={
            request.expectedAttendance !== null ? String(request.expectedAttendance) : 'Not provided'
          }
        />
        <Row label="Room layout" value={describeRoomLayout(request.roomLayout)} />
        <Row label="Preferred location" value={describePreferredLocation(request.preferredLocation)} />
        <Row label="Accessibility" value={describeAccessibility(request)} />
        <Row label="Equipment" value={describeEquipment(request)} />
        <Row label="Technical support" value={describeTechnicalSupport(request.technicalSupportNotes)} />
        <Row label="Attendee registration" value={describeRegistration(request.registrationRequired)} />
        {/* US-7.1-TC02 also asks for attachments; there is no attachment
            feature in this codebase to read one from. */}
        <Row label="Attachments" value="Not supported this sprint" />
        <Row label="Created" value={formatSingaporeDateTime(request.createdAt)} />
        {request.submittedAt ? (
          <Row label="Submitted" value={formatSingaporeDateTime(request.submittedAt)} />
        ) : null}
      </dl>

      {/* SCRUM-92 AC1 — "given I am reviewing a submitted request, when I
          approve it". This page is what the card means by reviewing it.

          Gated on canBeApproved, SCRUM-92's own rule, so the page offers the
          action exactly when the service would allow it and the screen can
          never present a button the API refuses. Who may approve is already
          settled by the time anything renders: the role check at the top of
          this page, and getReviewDetail, which refuses a coordinator the event
          has been reassigned away from (SCRUM-213).

          Added to SCRUM-89's page rather than a page of its own, the same way
          SCRUM-90's clarification form below already is. Nothing above this
          changed. */}
      {canBeApproved(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <ApproveRequestButton requestId={request.id} />
        </section>
      ) : null}

      {/* SCRUM-231 AC1-AC4 — the event's venue bookings, each released on its
          own with a reason. Releasing an affected one closes the outstanding
          action at the top of the page. */}
      <EventVenueBookings bookings={venueBookings} />

      {/* SCRUM-142 AC1-AC4 — "As an Event Coordinator, I want to request a
          specific venue for the slots my event needs". Gated on
          canCreateBookingRequest, SCRUM-142's own rule, the same way the
          Approve section above is gated on canBeApproved: the screen can
          never offer an action the API would refuse. */}
      {canCreateBookingRequest(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Request a venue</h2>
          <div className="mt-3">
            <RequestVenueBookingForm requestId={request.id} venues={venues} />
          </div>
        </section>
      ) : null}

      {canRequestClarification(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <RequestClarificationForm requestId={request.id} />
        </section>
      ) : null}

      {/* SCRUM-93 AC4 — the Coordinator's reject action, offered alongside
          clarification whenever the request is open to a decision. */}
      {canBeRejected(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <RejectRequestForm requestId={request.id} />
        </section>
      ) : null}
    </main>
  );
}
