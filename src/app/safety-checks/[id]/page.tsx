import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { SafetyCheckDecisionForm } from '@/components/safety-check/SafetyCheckDecisionForm';
import { SafetyCheckOutcome } from '@/components/safety-check/SafetyCheckOutcome';
import { describeEventTimes } from '@/domain/event-request/policy';
import { canRunSafetyCheck } from '@/domain/safety-check/policy';
import type { SafetyCheckView } from '@/domain/safety-check/schema';
import { getSafetyCheckView } from '@/domain/safety-check/service';
import { NotFoundError } from '@/domain/shared/errors';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { formatClockRange } from '@/domain/shared/times';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-234 — one event's operational safety check, for the Safety Officer.
 *
 * AC2 — expected attendance, each booked venue's capacity and layout,
 * accessibility needs and requested equipment, with anything never recorded
 * shown as "Not specified".
 * AC3-AC5 — the decision form, while the event is Confirmed. Afterwards the
 * page shows the decision instead, and every earlier check below it.
 * AC7 — anyone without the role is told the page is not for them.
 */

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

/** SCRUM-230 AC2: a requirement taken from the event is shown as the event's. */
const asEvents = (inUse: { description: string; fromEvent: boolean }) =>
  inUse.fromEvent && inUse.description !== 'Not specified' ? `${inUse.description} (event's)` : inUse.description;

export default async function SafetyCheckPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentActor();
  if (!canRunSafetyCheck(actor.roles)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Safety check</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Safety Officers. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const { id } = await params;
  let view: SafetyCheckView;
  try {
    view = await getSafetyCheckView(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const [latest, ...earlier] = view.checks;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/safety-checks" className="text-sm text-[var(--brand)] hover:underline">
        ← Safety checks
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{view.name}</h1>
        <EventRequestStatusBadge status={view.status} />
      </div>
      <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">{view.reference}</p>

      <dl className="mt-6 rounded border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Client organisation" value={view.clientOrganisation ?? 'Not linked'} />
        <Row label="Date" value={view.proposedDate ? formatSingaporeDate(view.proposedDate) : 'Not specified'} />
        <Row label="Time" value={describeEventTimes(view.startTime, view.endTime)} />
        <Row label="Expected attendance" value={view.expectedAttendance} />
        <Row label="Room layout" value={view.roomLayout} />
        <Row label="Accessibility needs" value={view.accessibility} />
      </dl>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Venues</h2>
        {view.venues.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">No confirmed venue bookings.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {view.venues.map((venue) => (
              <dl
                key={`${venue.venueId}-${venue.bookings[0]?.date}-${venue.bookings[0]?.startTime}`}
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-4"
              >
                <Row label="Venue" value={venue.venueName} />
                <Row label="Layout" value={asEvents(venue.layout)} />
                <Row
                  label="Capacity"
                  value={
                    venue.layoutCapacity === null
                      ? `${venue.maxCapacity} (maximum)`
                      : `${venue.layoutCapacity} in this layout (maximum ${venue.maxCapacity})`
                  }
                />
                <Row label="Expected attendance" value={asEvents(venue.expectedAttendance)} />
                <Row label="Accessibility needs" value={asEvents(venue.accessibility)} />
                <Row
                  label="Booked"
                  value={venue.bookings
                    .map((b) => `${formatSingaporeDate(b.date)}, ${formatClockRange({ start: b.startTime, end: b.endTime })}`)
                    .join('\n')}
                />
              </dl>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Requested equipment</h2>
        {view.equipment.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">Not specified</p>
        ) : (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
            {view.equipment.map((line, index) => (
              <li key={index}>
                {line.name} × {line.quantity}
              </li>
            ))}
          </ul>
        )}
        {view.technicalRequirements ? (
          <p className="mt-3 text-sm whitespace-pre-wrap">
            <span className="font-medium">Technical requirements:</span> {view.technicalRequirements}
          </p>
        ) : null}
      </section>

      <section className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-lg font-semibold">Decision</h2>
        {view.awaitingCheck ? (
          <div className="mt-3">
            <SafetyCheckDecisionForm eventRequestId={view.eventRequestId} />
          </div>
        ) : latest ? (
          <SafetyCheckOutcome check={latest} heading="Latest decision" />
        ) : (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Only a Confirmed event can be given a safety check decision.
          </p>
        )}
      </section>

      {(view.awaitingCheck ? view.checks : earlier).length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Earlier checks</h2>
          {(view.awaitingCheck ? view.checks : earlier).map((check) => (
            <SafetyCheckOutcome key={check.id} check={check} heading="Safety check" />
          ))}
        </section>
      ) : null}
    </main>
  );
}
