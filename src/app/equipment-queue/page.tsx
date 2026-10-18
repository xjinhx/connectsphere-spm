import Link from 'next/link';
import { TechnicalSupportNav } from '@/components/equipment/TechnicalSupportNav';
import { EquipmentRequestStatusBadge } from '@/components/equipment-request/EquipmentRequestStatusBadge';
import {
  EQUIPMENT_QUEUE_SORTS,
  daysUntilEvent,
  toEquipmentQueueSort,
  type EquipmentQueueSort,
} from '@/domain/equipment-request/policy';
import { listEquipmentQueue } from '@/domain/equipment-request/service';
import { isActionPermitted } from '@/domain/identity/permissions';
import { formatSingaporeDate, todayInSingapore } from '@/domain/shared/dates';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-164 Queue of equipment requests awaiting review — Technical Support
 * Staff's landing page.
 *
 * AC1 each outstanding request is listed with its event, the event's date and
 *     the requested items with their quantities, one line per item as the
 *     coordinator added them (TC-164-02: the same item twice is two lines).
 * AC2 "Sort by event date" reloads the list with the soonest event first
 *     (?sort=event-date). The default is the order requests were raised, the
 *     same pair of orders as SCRUM-147's booking queue.
 * AC3 fulfilled and unable to fulfil requests are not read.
 * AC4 a partially fulfilled request stays listed with how many items are still
 *     unavailable.
 * AC5 every Technical Support Staff member sees every location's requests;
 *     nothing here filters by location or equipment type.
 *
 * Each row opens the event's equipment request (SCRUM-160 AC6). Statuses and
 * unavailable items are set by hand until SCRUM-166 (dummy D-19).
 *
 * Needs equipment_administration (Technical Support Staff's), checked before
 * anything is read. force-dynamic, so a status changed in the database shows
 * on the next load (TC-164-09, TC-164-12).
 */

export const dynamic = 'force-dynamic';

const SORT_LABELS: Record<EquipmentQueueSort, string> = {
  raised: 'Date raised',
  'event-date': 'Event date (soonest first)',
};

function describeDaysUntil(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 0) return 'Date passed';
  return `In ${days} days`;
}

export default async function TechSupportEquipmentQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const actor = await getCurrentActor();

  if (!isActionPermitted(actor.roles, 'equipment_administration')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Equipment request queue</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Technical Support Staff. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const sort = toEquipmentQueueSort((await searchParams).sort);
  const entries = await listEquipmentQueue(sort);
  const today = todayInSingapore();

  const partiallyFulfilled = entries.filter((entry) => entry.status === 'partially_fulfilled').length;
  const upcomingDates = entries
    .map((entry) => entry.eventDate)
    .filter((date): date is string => date !== null && date >= today)
    .sort();
  const nextEventDate = upcomingDates[0] ?? null;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <TechnicalSupportNav current="queue" />

      <h1 className="text-2xl font-semibold">Equipment request queue</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Equipment requests awaiting review, for events at every location. Work through them before their events
        approach.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <dt className="text-sm text-[var(--text-muted)]">Outstanding requests</dt>
          <dd className="mt-1 text-2xl font-semibold">{entries.length}</dd>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <dt className="text-sm text-[var(--text-muted)]">Partially fulfilled</dt>
          <dd className="mt-1 text-2xl font-semibold">{partiallyFulfilled}</dd>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <dt className="text-sm text-[var(--text-muted)]">Next event</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {nextEventDate ? formatSingaporeDate(nextEventDate) : '—'}
          </dd>
        </div>
      </dl>

      <nav aria-label="Sort the queue" className="mt-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--text-muted)]">Sort by:</span>
        {EQUIPMENT_QUEUE_SORTS.map((option) =>
          option === sort ? (
            <span key={option} aria-current="true" className="rounded-md bg-[var(--brand)] px-3 py-1 font-medium text-white">
              {SORT_LABELS[option]}
            </span>
          ) : (
            <Link
              key={option}
              href={option === 'raised' ? '/equipment-queue' : `/equipment-queue?sort=${option}`}
              className="rounded-md border border-[var(--border)] px-3 py-1 hover:bg-slate-50"
            >
              {SORT_LABELS[option]}
            </Link>
          ),
        )}
      </nav>

      {entries.length === 0 ? (
        <p className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--text-muted)]">
          No equipment requests are awaiting review.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="p-3 font-medium">Event</th>
                <th scope="col" className="p-3 font-medium">Event date</th>
                <th scope="col" className="p-3 font-medium">Requested items</th>
                <th scope="col" className="p-3 font-medium">Status</th>
                <th scope="col" className="p-3 font-medium">Still unavailable</th>
                <th scope="col" className="p-3 font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const days = daysUntilEvent(entry.eventDate, today);
                return (
                  <tr key={entry.eventRequestId} className="border-b border-[var(--border)] align-top last:border-0">
                    <td className="p-3">
                      <span className="font-medium">{entry.eventName}</span>
                      <span className="block font-mono text-xs text-[var(--text-muted)]">{entry.eventReference}</span>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {entry.eventDate ? (
                        <>
                          {formatSingaporeDate(entry.eventDate)}
                          <span
                            className={`block text-xs ${
                              days !== null && days >= 0 && days <= 7 ? 'font-medium text-[var(--warning)]' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {describeDaysUntil(days)}
                          </span>
                        </>
                      ) : (
                        <span className="text-[var(--text-muted)]">Date not set</span>
                      )}
                    </td>
                    <td className="p-3">
                      <ul className="space-y-0.5">
                        {entry.lines.map((line) => (
                          <li key={line.id}>
                            {line.equipmentName} <span className="text-[var(--text-muted)]">× {line.quantity}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="p-3">
                      <EquipmentRequestStatusBadge status={entry.status} />
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {entry.status === 'partially_fulfilled' ? (
                        <span className="font-medium text-amber-700">
                          {entry.unavailableCount === 1 ? '1 item' : `${entry.unavailableCount} items`}
                        </span>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Link
                        href={`/events/${entry.eventRequestId}/equipment`}
                        className="whitespace-nowrap rounded-md border border-[var(--brand)] px-3 py-1 text-[var(--brand)] hover:bg-blue-50"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-sm text-[var(--text-muted)]">
        {entries.length === 1 ? '1 equipment request awaiting review.' : `${entries.length} equipment requests awaiting review.`}
      </p>
    </main>
  );
}
