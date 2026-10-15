import Link from 'next/link';
import { formatSingaporeDate } from '@/domain/shared/dates';
import type { EventBookingRequest, VenueBookingRequestStatus } from '@/domain/venue-booking/schema';

const STATUS_LABELS: Record<VenueBookingRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  partially_approved: 'Partially Approved',
  rejected: 'Rejected',
};

/**
 * SCRUM-236 AC1 — the event's booking requests, newest first, each with its
 * venue, requested dates with their start and end times, and status.
 * AC2 — each opens its booking request page (SCRUM-149 AC3), which shows every
 * decision, who made it and the reason for any rejection.
 * AC3 — an event with no requests says so, rather than listing none silently.
 */
export function EventBookingRequests({ requests }: { requests: EventBookingRequest[] }) {
  return (
    <section
      aria-labelledby="booking-requests-heading"
      className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <h2 id="booking-requests-heading" className="text-sm font-semibold">
        Booking requests
      </h2>
      {requests.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">No booking requests yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {requests.map((request) => (
            <li key={request.id} className="py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/venue-booking-requests/${request.id}`}
                  className="font-medium text-[var(--brand)] hover:underline"
                >
                  {request.venueName}
                </Link>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs font-medium">
                  {STATUS_LABELS[request.status]}
                </span>
              </div>
              <p className="mt-1 text-[var(--text-muted)]">
                {request.lines
                  .map((line) => `${formatSingaporeDate(line.date)}, ${line.startTime}–${line.endTime}`)
                  .join('; ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
