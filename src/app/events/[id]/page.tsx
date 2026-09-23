import Link from 'next/link';
import CoordinatorPanel from '@/components/assignment/CoordinatorPanel';
import { ClarificationResponseForm } from '@/components/event-request/ClarificationResponseForm';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { SubmitEventRequestButton } from '@/components/event-request/SubmitEventRequestButton';
import {
  canBeSubmitted,
  canEditRequest,
  describeAccessibility,
  describeEquipment,
  describePreferredLocation,
  describeRegistration,
  describeRoomLayout,
  describeTechnicalSupport,
  describeTimeSlots,
} from '@/domain/event-request/policy';
import { getEventRequest } from '@/domain/event-request/service';
import { getApprovalView, getClarificationView, getRejectionView } from '@/domain/review/service';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

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

export default async function EventRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [actor, request] = await Promise.all([getCurrentActor(), getEventRequest(id)]);
  // SCRUM-82 AC2/AC4 — one rule decides every action shown on this page.
  // SCRUM-204 AC3 — and only the owner ever gets them: a colleague viewing a
  // shared, still-editable (e.g. Clarification Requested) request sees the
  // read-only notice below instead, never the edit actions.
  const editable = canEditRequest(request, actor.userId);
  // SCRUM-91 AC1 — a coordinator has asked something and is waiting for an
  // answer. Taken from the status rather than from "is there an open round",
  // because this decides what the page offers, and the page should not need a
  // second read to know what the badge beside the title already says.
  //
  // Built on `editable`, not on the status alone: SCRUM-204 AC3 shares a
  // request in Clarification Requested with the whole client organisation, and
  // a colleague must not be offered the box that answers it. Only the organiser
  // who owns the request may reply - the same rule respondToClarification
  // enforces, so the page cannot offer an action the API would refuse.
  const awaitingResponse = editable && request.status === 'clarification_requested';
  // Bug fix, 2026-09-22 — a clarification-requested request is editable
  // again (SCRUM-90 AC2), but resubmitting it through the plain Submit button
  // is exactly the bug this branch fixes (canBeSubmitted no longer accepts
  // it, see policy.ts): once awaitingResponse is true, SCRUM-91's response
  // form above is the only way back, so this flag never even gets consulted
  // for that status. Kept as its own flag for the draft case, so "editable"
  // and "submittable" can disagree there too without the Submit button
  // offering an action that would just error.
  const submittable = canBeSubmitted(request.status);
  // US-7.2 AC1/AC3 — the clarification note, if a coordinator has raised one.
  // A separate read (getClarificationView) rather than a field on `request`
  // itself — see the comment on ClarificationView in domain/review/service.ts.
  //
  // SCRUM-92 AC2 — "when the Event Organiser views it, the approval outcome and
  // date are shown together with a statement that no venue, equipment or
  // registration arrangement is yet committed". Read alongside the clarification
  // rather than after it: neither depends on the other.
  //
  // getApprovalView rather than request.status, because AC2 asks for the
  // decision date and the statement, and neither is on the request the page
  // already holds. Both take `actor` (SCRUM-72 AC2) — an Attendee-only account
  // is refused internal planning data even here, though getEventRequest above
  // already keeps anyone but the owning organiser from reaching this line.
  // SCRUM-93 AC4/AC6 — the rejection reason and date, if this request has
  // been rejected. Same reasoning as the clarification/approval reads above:
  // a separate read rather than a field on `request` itself.
  const [clarification, approval, rejection] = await Promise.all([
    getClarificationView(id, actor),
    getApprovalView(id, actor),
    getRejectionView(id),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/events" className="text-sm text-[var(--brand)] hover:underline">
        ← My event requests
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{request.name}</h1>
        <EventRequestStatusBadge status={request.status} />
      </div>
      {/* AC2: the unique reference the database assigned on save. */}
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{request.reference}</p>

      {/* SCRUM-92 AC2: the outcome, the date, and the statement — the three
          things the card asks the Organiser be shown, in that order.

          AC3: "its status is not Confirmed and no venue or equipment is shown
          as committed". The badge above says Approved and this says plainly
          that nothing is committed yet, so an approval cannot be mistaken for a
          booking. Nothing on this page claims a venue or equipment either.

          Matched on 'approved' rather than on decision being set: SCRUM-93 adds
          'rejected' to the same column, and a rejected request must not be
          announced here as approved. That story owns how a rejection reads. */}
      {approval.decision === 'approved' ? (
        <div className="mt-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm">
          <p className="font-medium text-green-700">Approved</p>
          {/* AC2's "date". Stamped by the database (set_decided_at), and shown
              in Singapore time like every other time on this page. */}
          {approval.decidedAt ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Approved {formatSingaporeDateTime(approval.decidedAt)}
            </p>
          ) : null}
          {/* The statement comes from the domain (COMMITMENT_STATEMENT), not
              written out again here, so the page and the API cannot drift into
              telling the Organiser two different things. */}
          <p className="mt-2">{approval.commitmentStatement}</p>
        </div>
      ) : null}

      {/* US-7.2 AC1/AC3: what the Coordinator needs, shown as soon as one has
          asked for it. Replying to it is SCRUM-91, and the form that does so is
          in the actions section below. */}
      {clarification.clarificationNote ? (
        <div className="mt-4 rounded-md border border-[var(--warning)] bg-amber-50 px-3 py-2 text-sm">
          {/* The note is kept on the record after it has been addressed (AC3),
              so it only reads as an outstanding ask while the request is
              actually waiting on one. */}
          <p className="font-medium text-[var(--warning)]">
            {clarification.status === 'clarification_requested'
              ? 'A coordinator has asked for clarification'
              : 'Clarification asked for earlier'}
          </p>
          <p className="mt-1 whitespace-pre-wrap">{clarification.clarificationNote}</p>
          {clarification.clarificationRequestedAt ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Requested {formatSingaporeDateTime(clarification.clarificationRequestedAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* SCRUM-93 AC4/AC6 — the reason and date, shown as soon as the
          request has been rejected. Separate read (getRejectionView), same
          reasoning as the clarification banner above. */}
      {rejection.rejectionReason ? (
        <div className="mt-4 rounded-md border border-[var(--danger)] bg-red-50 px-3 py-2 text-sm">
          <p className="font-medium text-[var(--danger)]">This request was rejected</p>
          <p className="mt-1 whitespace-pre-wrap">{rejection.rejectionReason}</p>
          {rejection.decidedAt ? (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Rejected {formatSingaporeDateTime(rejection.decidedAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* AC5: every date and time on this page is rendered in Singapore time. */}
      <dl className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Purpose" value={request.purpose ?? 'Not yet provided'} />
        <Row label="Description" value={request.description ?? 'Not yet provided'} />
        <Row
          label="Proposed date"
          value={
            request.proposedDate ? formatSingaporeDate(request.proposedDate) : 'Not yet provided'
          }
        />
        {/* SCRUM-77 AC2: all three slots read as a full-day booking requirement. */}
        <Row
          label="Time slots"
          value={describeTimeSlots(request.timeSlots)}
        />
        {/* SCRUM-78. Was missing from this page entirely - confirmed via a
            manual walkthrough (2026-09-16) that the API already returned it
            correctly and only the row was never added. */}
        <Row
          label="Expected attendance"
          value={
            request.expectedAttendance !== null ? String(request.expectedAttendance) : 'Not yet provided'
          }
        />
        {/* SCRUM-79 AC1: the layout, as saved with the request. */}
        <Row label="Room layout" value={describeRoomLayout(request.roomLayout)} />
        {/* SCRUM-79 AC4: a blank choice reads as no preference, not as missing. */}
        <Row
          label="Preferred location"
          value={describePreferredLocation(request.preferredLocation)}
        />
        {/* SCRUM-79 AC2/AC3: the answer given, "None required" included. */}
        <Row label="Accessibility" value={describeAccessibility(request)} />
        {/* SCRUM-80 AC1/AC3: the items listed, or the explicit "none". */}
        <Row label="Equipment" value={describeEquipment(request)} />
        {/* SCRUM-80 AC2: shown on its own, whatever the equipment answer. */}
        <Row
          label="Technical support"
          value={describeTechnicalSupport(request.technicalSupportNotes)}
        />
        {/* SCRUM-81 AC1/AC2: the answer as stored; "Not required" is an answer. */}
        <Row
          label="Attendee registration"
          value={describeRegistration(request.registrationRequired)}
        />
        <Row label="Created" value={formatSingaporeDateTime(request.createdAt)} />
        <Row label="Last updated" value={formatSingaporeDateTime(request.updatedAt)} />
        {/* SCRUM-82 AC1: the submission time, in Singapore time. */}
        {request.submittedAt ? (
          <Row label="Submitted" value={formatSingaporeDateTime(request.submittedAt)} />
        ) : null}
      </dl>

      {/* SCRUM-98: who the organiser's coordinator is (panel owned by SCRUM-96/98).
          SCRUM-204 AC3 — canViewCoordinatorDetails (SCRUM-96/98's own rule,
          not touched here) does not grant a colleague access to this, so it
          is only rendered for the owner viewing their own request. */}
      {request.organiserId === actor.userId && <CoordinatorPanel eventRequestId={request.id} />}

      {/* SCRUM-82 AC4: a submitted request is read-only - no edit, save or
          delete is offered. Only a draft gets an action.

          SCRUM-91 AC1: a request returned for clarification is editable too
          (isEditable, SCRUM-90 AC2), but it is not a draft and it is not
          resubmitted the same way - it goes back with an answer. It therefore
          gets its own branch, above the draft one, rather than falling through
          to a Submit button that would send the coordinator's question back
          unanswered. */}
      <section className="mt-6">
        {awaitingResponse ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <ClarificationResponseForm requestId={request.id} />
          </div>
        ) : editable ? (
          <>
            {submittable ? (
              // SCRUM-84 AC2: an explicit statement that a draft has not yet
              // reached ConnectSphere, distinct from the submitted read-only
              // notice below.
              <p className="mb-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
                This is a draft. ConnectSphere has not yet received it — save your changes or submit when ready.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {/* Bug fix, 2026-09-22 — no longer offered while a clarification
                  is open: resubmitting here would error, since canBeSubmitted
                  no longer accepts clarification_requested (see policy.ts). */}
              {submittable ? <SubmitEventRequestButton requestId={request.id} /> : null}
              {/* SCRUM-85 AC3 — the way back into a saved draft. */}
              <Link
                href={`/events/${request.id}/edit`}
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
              >
                Continue editing
              </Link>
            </div>
          </>
        ) : request.organiserId !== actor.userId ? (
          // SCRUM-204 AC3 — shared with the organisation, view-only: only its
          // owner can act on it, whatever its status. Checked before the
          // rejected-specific branch below, since AC3 applies "whatever its
          // status" - a colleague viewing a rejected request gets this
          // generic notice too, not SCRUM-93's rejection-specific one.
          <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
            This request belongs to a colleague in your organisation. You can view it, but only
            its owner can change or submit it.
          </p>
        ) : request.status === 'rejected' ? (
          // SCRUM-93 AC6 — a rejected request cannot be edited or resubmitted,
          // and the organiser is told a new request must be raised instead
          // (the "Create another request" link below does that).
          <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
            This request has been rejected and cannot be edited or resubmitted. Raise a new
            request instead.
          </p>
        ) : (
          <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
            This request has been submitted and is now read-only. It can be changed again only
            if a coordinator returns it with a clarification request.
          </p>
        )}
      </section>

      <Link
        href="/events/new"
        className="mt-6 inline-block text-sm text-[var(--brand)] hover:underline"
      >
        Create another request
      </Link>
    </main>
  );
}
