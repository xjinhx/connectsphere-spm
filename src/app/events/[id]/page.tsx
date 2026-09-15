import Link from 'next/link';
import CoordinatorPanel from '@/components/assignment/CoordinatorPanel';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { SubmitEventRequestButton } from '@/components/event-request/SubmitEventRequestButton';
import {
  describeAccessibility,
  describeEquipment,
  describePreferredLocation,
  describeRegistration,
  describeRoomLayout,
  describeTechnicalSupport,
  describeTimeSlots,
  isEditable,
} from '@/domain/event-request/policy';
import { getEventRequest } from '@/domain/event-request/service';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';

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
  const request = await getEventRequest(id);
  // SCRUM-82 AC2/AC4 — one rule decides every action shown on this page.
  const editable = isEditable(request.status);

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

      {/* SCRUM-98: who the organiser's coordinator is (panel owned by SCRUM-96/98). */}
      <CoordinatorPanel eventRequestId={request.id} />

      {/* SCRUM-82 AC4: a submitted request is read-only - no edit, save or
          delete is offered. Only a draft gets an action. */}
      <section className="mt-6">
        {editable ? (
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
