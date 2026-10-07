import Link from 'next/link';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { isActionPermitted } from '@/domain/identity/permissions';
import { listPendingBookingQueue } from '@/domain/venue-booking/service';
import { BOOKING_QUEUE_SORTS, toBookingQueueSort, type BookingQueueSort } from '@/domain/venue-booking/policy';
import { describeTimeSlots } from '@/domain/event-request/policy';
import { formatSingaporeDate, toSingaporeISODate } from '@/domain/shared/dates';

/**
 * SCRUM-147 View the pending booking request queue — Venue Staff's landing page.
 *
 * AC1 each pending request is listed with its venue, event, requested date and
 *     slots, and the date it was requested. One row per date-and-slots line,
 *     as each line is decided on its own (SCRUM-148 AC5).
 * AC2 "Sort by requested event date" reloads the list with the soonest event
 *     first (?sort=event-date). The default is the order requests arrived.
 * AC3 a decided line is not listed: only pending lines are read.
 * AC4 every Venue Staff member sees every venue's requests; nothing here
 *     filters by venue.
 *
 * Each row opens the request on SCRUM-148's decision page, where Venue Staff
 * approve or reject it.
 *
 * Needs venue_administration (Venue Staff's), the same permission SCRUM-148's
 * decision page uses, checked before anything is read.
 */

export const dynamic = 'force-dynamic';

const SORT_LABELS: Record<BookingQueueSort, string> = {
  requested: 'Date requested',
  'event-date': 'Requested event date',
};

export default async function VenueStaffBookingQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  const actor = await getCurrentActor();

  if (!isActionPermitted(actor.roles, 'venue_administration')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Pending booking requests</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Venue Staff. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const sort = toBookingQueueSort((await searchParams).sort);
  const entries = await listPendingBookingQueue(sort);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Pending booking requests</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Every venue booking request awaiting a decision, at every venue.
      </p>

      <nav aria-label="Sort the queue" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--text-muted)]">Sort by:</span>
        {BOOKING_QUEUE_SORTS.map((option) =>
          option === sort ? (
            <span key={option} aria-current="true" className="rounded-md bg-[var(--brand)] px-3 py-1 font-medium text-white">
              {SORT_LABELS[option]}
            </span>
          ) : (
            <Link
              key={option}
              href={option === 'requested' ? '/booking-queue' : `/booking-queue?sort=${option}`}
              className="rounded-md border border-[var(--border)] px-3 py-1 hover:bg-slate-50"
            >
              {SORT_LABELS[option]}
            </Link>
          ),
        )}
      </nav>

      {entries.length === 0 ? (
        <p className="mt-6 text-[var(--text-muted)]">No booking requests are waiting for a decision.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--border)] text-[var(--text-muted)]">
              <tr>
                <th scope="col" className="p-3 font-medium">Venue</th>
                <th scope="col" className="p-3 font-medium">Event</th>
                <th scope="col" className="p-3 font-medium">Requested date</th>
                <th scope="col" className="p-3 font-medium">Slots</th>
                <th scope="col" className="p-3 font-medium">Requested on</th>
                <th scope="col" className="p-3 font-medium">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.lineId} className="border-b border-[var(--border)] last:border-0">
                  <td className="p-3">{entry.venueName}</td>
                  <td className="p-3">
                    <span className="font-medium">{entry.eventName}</span>
                    <span className="block font-mono text-xs text-[var(--text-muted)]">{entry.eventReference}</span>
                  </td>
                  <td className="p-3">{formatSingaporeDate(entry.date)}</td>
                  <td className="p-3">{describeTimeSlots(entry.timeSlots)}</td>
                  <td className="p-3">{formatSingaporeDate(toSingaporeISODate(new Date(entry.requestedAt)))}</td>
                  <td className="p-3">
                    <Link href={`/venue-booking-requests/${entry.requestId}`} className="text-[var(--brand)] hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-sm text-[var(--text-muted)]">
        {entries.length === 1 ? '1 request line awaiting a decision.' : `${entries.length} request lines awaiting a decision.`}
      </p>
    </main>
  );
}
