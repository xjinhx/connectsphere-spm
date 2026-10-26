import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApproveRequestButton } from '@/components/event-request/ApproveRequestButton';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { ClarificationRounds } from '@/components/event-request/ClarificationRounds';
import { RejectRequestForm } from '@/components/event-request/RejectRequestForm';
import { RequestClarificationForm } from '@/components/event-request/RequestClarificationForm';
import { AffectedBookingsNotice } from '@/components/venue/AffectedBookingsNotice';
import { listAffectedBookings } from '@/domain/availability/service';
import { EventBookingRequests } from '@/components/venue-booking/EventBookingRequests';
import { listEventBookingRequests } from '@/domain/venue-booking/service';
import { RequestVenueBookingForm } from '@/components/event-request/RequestVenueBookingForm';
import { SuitabilityCheckForm } from '@/components/suitability/SuitabilityCheckForm';
import { listSuitabilityChecks } from '@/domain/suitability/service';
import type { SuitabilityCheck } from '@/domain/suitability/schema';
import { EventVenueBookings } from '@/components/venue-booking/EventVenueBookings';
import { canCreateBookingRequest, canRequestReplacement } from '@/domain/venue-booking/policy';
import { acceptsEquipmentRequest } from '@/domain/equipment-request/policy';
import { listEventVenueBookings } from '@/domain/venue-booking/service';
import { listVenues } from '@/domain/venues/service';
import { EssentialArrangementsPanel } from '@/components/event-request/EssentialArrangementsPanel';
import { getEssentialArrangements } from '@/domain/essential-arrangements/service';
import { EventInformationPanel } from '@/components/event-request/EventInformationPanel';
import { getEventInformation } from '@/domain/event-information/service';
import { ArrangementReviewPanel } from '@/components/event-request/ArrangementReviewPanel';
import { EventSchedulePanel } from '@/components/event-request/EventSchedulePanel';
import { getEventSchedule } from '@/domain/significant-change/service';
import { ConfirmEventButton } from '@/components/event-request/ConfirmEventButton';
import { canBeConfirmed } from '@/domain/event-status/policy';
import { acceptsRegistrationSettings } from '@/domain/registration-list/policy';
import {
  describeAccessibility,
  describeEquipment,
  describePreferredLocation,
  describeRegistration,
  describeRoomLayout,
  describeTechnicalSupport,
  describeEventTimes,
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
import { SafetyCheckOutcome } from '@/components/safety-check/SafetyCheckOutcome';
import { getLatestSafetyCheck } from '@/domain/safety-check/service';
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
  //
  // SCRUM-232 AC5: the Event Coordinator Lead (coordinator_assignment) may
  // also pass this gate — read-only, never to act. getReviewDetail decides
  // the rest, and canManage below decides what renders.
  if (
    !isActionPermitted(actor.roles, 'event_request_review') &&
    !isActionPermitted(actor.roles, 'coordinator_assignment')
  ) {
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
    request = await getReviewDetail(id, actor.userId, actor.roles);
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
    // AC3 — assigned to another Coordinator, or (SCRUM-232 AC5) not assigned
    // to anyone yet. Shown as a refusal rather than a crash, and nothing
    // about the request is rendered.
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <Link href="/assigned-events" className="text-sm text-[var(--brand)] hover:underline">
            ← Assigned events
          </Link>
          <h1 className="mt-4 text-2xl font-semibold">Review request</h1>
          <p className="mt-4 text-[var(--text-muted)]">
            This request is not assigned to you, so you cannot review it.
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
  //
  // SCRUM-232 AC5: also only for the assigned coordinator — the Lead viewing
  // read-only never sees this form, so there is nothing to fetch venues for.
  //
  // SCRUM-229 AC1, AC2: an affected booking can be replaced by whoever may
  // release it (SCRUM-231 AC3: the assigned coordinator, so never the Lead),
  // while the event allows a replacement request, Confirmed included.
  const replaceableBookingIds = canRequestReplacement(request.status)
    ? affectedBookings
        .filter((affected) => venueBookings.some((booking) => booking.id === affected.bookingId && booking.canRelease))
        .map((affected) => affected.bookingId)
    : [];
  const venues =
    request.canManage && (canCreateBookingRequest(request.status) || replaceableBookingIds.length > 0)
      ? await listVenues()
      : [];
  // SCRUM-230 AC2: what each empty venue requirement falls back to.
  const eventRequirements = {
    expectedAttendance: request.expectedAttendance,
    roomLayout: describeRoomLayout(request.roomLayout),
    accessibility: describeAccessibility(request),
  };

  // SCRUM-236 AC1-AC3, read for the same reason after getReviewDetail.
  const bookingRequests = await listEventBookingRequests(request.id);

  // SCRUM-100 AC1-AC3, read for the same reason after getReviewDetail.
  const essentialArrangements = await getEssentialArrangements(request.id, actor.userId);

  // SCRUM-110 AC1/AC5, read for the same reason after getReviewDetail. It also
  // refuses anyone who is neither the assigned coordinator nor the Lead,
  // because it carries the internal notes.
  const eventInformation = await getEventInformation(request.id, actor);
  // SCRUM-111, read for the same reason and refusing the same people.
  const eventSchedule = await getEventSchedule(request.id, actor);

  // SCRUM-135 AC3: the venues already checked, shown again without running
  // them. Only the event's own coordinator has any; anyone else sees none.
  let suitabilityChecks: SuitabilityCheck[] = [];
  if (canCreateBookingRequest(request.status)) {
    try {
      suitabilityChecks = await listSuitabilityChecks(request.id, actor.userId);
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error;
    }
  }

  // SCRUM-234 AC4 — the assigned coordinator sees the Safety Officer's
  // latest decision, with its reason. Read for canManage only, the
  // same gate as the decision sections below: the Lead is not shown it.
  const safetyCheck = request.canManage ? await getLatestSafetyCheck(request.id, actor) : null;

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
      <AffectedBookingsNotice
        bookings={affectedBookings}
        replacement={{ eventId: request.id, bookingIds: replaceableBookingIds, venues, eventRequirements }}
      />

      {/* SCRUM-111 AC8, AC9 — arrangements a significant change marked for
          review, each re-confirmed here. Near the top for the same reason. */}
      <ArrangementReviewPanel requestId={request.id} view={eventSchedule} />

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

      {safetyCheck ? <SafetyCheckOutcome check={safetyCheck} /> : null}

      <dl className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Purpose" value={request.purpose ?? 'Not provided'} />
        {/* Description moved to the Event information section below
            (SCRUM-110), where the coordinator can edit it. */}
        <Row
          label="Proposed date"
          value={request.proposedDate ? formatSingaporeDate(request.proposedDate) : 'Not provided'}
        />
        {/* SCRUM-238 AC6/AC7 */}
        <Row label="Time" value={describeEventTimes(request.startTime, request.endTime)} />
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

      {/* SCRUM-110 AC1/AC5 — description, internal notes and client contact.
          The edit action only for the assigned coordinator of an event that is
          not Completed or Cancelled; saving flags no arrangement. */}
      <EventInformationPanel requestId={request.id} view={eventInformation} />

      {/* SCRUM-111 AC1-AC5 — change the date, times, attendance or venue
          requirements. Lists the arrangements the change affects and asks for
          the acknowledgement before saving; only for the assigned coordinator. */}
      <EventSchedulePanel requestId={request.id} view={eventSchedule} />

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
          changed.

          SCRUM-232 AC5: also gated on canManage — the Lead can review basic
          event information but does not manage the event, so this (and every
          other decision section below) renders only for the assigned
          coordinator. */}
      {request.canManage && canBeApproved(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <ApproveRequestButton requestId={request.id} />
        </section>
      ) : null}

      {/* SCRUM-100 AC1-AC3 — which arrangements are essential for this event.
          Shown in every status (AC2); the form only where the coordinator may
          change the set. */}
      <EssentialArrangementsPanel requestId={request.id} view={essentialArrangements} />

      {/* SCRUM-102 — confirm the event, right under the essential set it is
          checked against. Planning only (TC-102-16), and only for the assigned
          coordinator (canManage), so the Lead viewing read-only never sees it. */}
      {request.canManage && canBeConfirmed(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <ConfirmEventButton requestId={request.id} />
        </section>
      ) : null}

      {/* SCRUM-231 AC1-AC4 — the event's venue bookings, each released on its
          own with a reason. Releasing an affected one closes the outstanding
          action at the top of the page. */}
      <EventVenueBookings bookings={venueBookings} />

      {/* SCRUM-135, SCRUM-136 — check a selected venue against the event
          before asking Venue Staff for it ("so that a room that cannot hold
          the event is never requested"), or one of the event's booking
          requests at its venue (SCRUM-135 AC4, SCRUM-136 AC5; SCRUM-236's
          list). Offered whenever a venue can be requested, just above that
          form; the service refuses anyone but the event's coordinator. */}
      {canCreateBookingRequest(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Check venue suitability</h2>
          <div className="mt-3">
            <SuitabilityCheckForm
              requestId={request.id}
              venues={venues}
              checks={suitabilityChecks}
              bookingRequests={bookingRequests.map((bookingRequest) => ({
                id: bookingRequest.id,
                label: `${bookingRequest.venueName}, ${bookingRequest.lines
                  .map((line) => `${formatSingaporeDate(line.date)} ${line.startTime}-${line.endTime}`)
                  .join('; ')}`,
              }))}
            />
          </div>
        </section>
      ) : null}

      {/* SCRUM-142 AC1-AC4 — "As an Event Coordinator, I want to request a
          specific venue for the times my event needs" (in exact times since
          SCRUM-239 AC3). Gated on
          canCreateBookingRequest, SCRUM-142's own rule, the same way the
          Approve section above is gated on canBeApproved: the screen can
          never offer an action the API would refuse. */}
      {request.canManage && canCreateBookingRequest(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Request a venue</h2>
          <div className="mt-3">
            {/* SCRUM-239 AC3: the request starts from the event's own date and times (SCRUM-238).
                SCRUM-230 AC2: each venue requirement left empty shows the event's. */}
            <RequestVenueBookingForm
              requestId={request.id}
              venues={venues}
              eventPeriod={{ date: request.proposedDate, start: request.startTime, end: request.endTime }}
              eventRequirements={eventRequirements}
            />
          </div>
        </section>
      ) : null}

      {/* SCRUM-160 — "As an Event Coordinator, I want to record the equipment
          an event needs with quantities". Recorded on its own page; offered
          while the event is Approved or in Planning, the statuses AC1 accepts
          (acceptsEquipmentRequest), so the link never leads to a form the API
          would refuse. */}
      {acceptsEquipmentRequest(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Equipment</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Record the equipment this event needs, so Technical Support Staff know what to arrange.
          </p>
          <Link
            href={`/events/${request.id}/equipment`}
            className="mt-3 inline-block rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
          >
            Equipment request
          </Link>
        </section>
      ) : null}

      {/* SCRUM-185 AC5 — the registration start date, end date and capacity,
          set on the event's registration page. Offered while the event is
          Confirmed (acceptsRegistrationSettings), so the link never leads to
          a form the API would refuse. */}
      {acceptsRegistrationSettings(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-semibold">Registration</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Set when attendees can register and how many places the event has.
          </p>
          <Link
            href={`/events/${request.id}/registrations`}
            className="mt-3 inline-block rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
          >
            Registration
          </Link>
        </section>
      ) : null}

      {/* SCRUM-236 AC1-AC3 — every booking request made for this event, each
          opening its booking request page. Shown in every status, so earlier
          requests stay visible after the event moves on. */}
      <EventBookingRequests requests={bookingRequests} />

      {request.canManage && canRequestClarification(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <RequestClarificationForm requestId={request.id} />
        </section>
      ) : null}

      {/* SCRUM-93 AC4 — the Coordinator's reject action, offered alongside
          clarification whenever the request is open to a decision. */}
      {request.canManage && canBeRejected(request.status) ? (
        <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <RejectRequestForm requestId={request.id} />
        </section>
      ) : null}
    </main>
  );
}
