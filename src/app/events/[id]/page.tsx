import Link from 'next/link';
import CoordinatorPanel from '@/components/assignment/CoordinatorPanel';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { SubmitEventRequestButton } from '@/components/event-request/SubmitEventRequestButton';
import {
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
import { getClarificationView } from '@/domain/review/service';
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
  // US-7.2 AC1/AC3 — the clarification note, if a coordinator has raised one.
  // A separate read (getClarificationView) rather than a field on `request`
  // itself — see the comment on ClarificationView in domain/review/service.ts.
  const clarification = await getClarificationView(id);

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

      {/* US-7.2 AC1/AC3: what the Coordinator needs, shown as soon as one has
          asked for it. No response is offered here — replying to it (US-7.2
          AC2) is a separate, unbuilt story (SCRUM-91). */}
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
          delete is offered. Only a draft gets an action. */}
      <section className="mt-6">
        {editable ? (
          <>
            {/* SCRUM-84 AC2: an explicit statement that a draft has not yet
                reached ConnectSphere, distinct from the submitted read-only
                notice below. */}
            <p className="mb-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
              This is a draft. ConnectSphere has not yet received it — save your changes or submit when ready.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitEventRequestButton requestId={request.id} />
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
          // owner can act on it, whatever its status.
          <p className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-muted)]">
            This request belongs to a colleague in your organisation. You can view it, but only
            its owner can change or submit it.
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
