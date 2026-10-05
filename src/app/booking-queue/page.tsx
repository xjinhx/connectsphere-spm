import { getCurrentActor } from '@/lib/auth/currentActor';
import { isActionPermitted } from '@/domain/identity/permissions';
import { listPendingBookingQueue } from '@/domain/venue-booking/service';
import { describeTimeSlots } from '@/domain/event-request/policy';
import { formatSingaporeDate, toSingaporeISODate } from '@/domain/shared/dates';

/**
 * SCRUM-147 View the pending booking request queue — Venue Staff's landing page.
 *
 * AC1 each pending request is listed with its venue, event, requested date and
 *     slots, and the date it was requested. One row per date-and-slots line,
 *     as each line is decided on its own (SCRUM-148 AC5).
 * AC3 a decided line is not listed: only pending lines are read.
 * AC4 every Venue Staff member sees every venue's requests; nothing here
 *     filters by venue.
 *
 * Needs venue_booking_review (SCRUM-69's permission matrix), checked before
 * anything is read.
 */

export const dynamic = 'force-dynamic';

export default async function VenueStaffBookingQueuePage() {
  const actor = await getCurrentActor();

  if (!isActionPermitted(actor.roles, 'venue_booking_review')) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold">Pending booking requests</h1>
        <p className="mt-4 text-[var(--text-muted)]">
          This page is for Venue Staff. Your account does not currently hold that role.
        </p>
      </main>
    );
  }

  const entries = await listPendingBookingQueue();

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold">Pending booking requests</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Every venue booking request awaiting a decision, at every venue.
      </p>

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
