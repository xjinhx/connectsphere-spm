import Link from 'next/link';
import type { DateWindow, EquipmentAvailability } from '@/domain/equipment-reservation/schema';
import { formatSingaporeDate } from '@/domain/shared/dates';

export function formatWindow(window: DateWindow): string {
  return `${formatSingaporeDate(window.start)} to ${formatSingaporeDate(window.end)}`;
}

/**
 * SCRUM-167: the availability check on the event's equipment page, run each
 * time the page is loaded ("Check again" reloads it).
 *
 * AC1 the window it was checked over, collection day to Return Day.
 * AC3 an event with no approved venue booking shows why nothing was checked.
 * AC4 each line with requested, already reserved, available and shortfall. An
 *     item with nothing available says so, to the coordinator as well as to
 *     Technical Support Staff.
 */
export function EquipmentAvailabilitySection({
  eventRequestId,
  availability,
  refusal,
}: {
  eventRequestId: string;
  availability: EquipmentAvailability | null;
  refusal: string | null;
}) {
  return (
    <section className="mt-6" aria-labelledby="availability-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="availability-heading" className="text-sm font-semibold">
          Availability check
        </h2>
        <Link href={`/events/${eventRequestId}/equipment`} className="text-sm text-[var(--brand)] hover:underline">
          Check again
        </Link>
      </div>

      {availability === null ? (
        <p role="alert" className="mt-2 rounded border border-[var(--warning)] bg-amber-50 p-4 text-sm">
          {refusal}
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Commitment window: {formatWindow(availability.window)} (collection day to Return Day). Units another event
            holds on any day of it are not available.
          </p>
          {availability.lines.length === 0 ? (
            <p className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
              No equipment has been requested yet.
            </p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th scope="col" className="p-3 font-medium">Item</th>
                    <th scope="col" className="p-3 font-medium">Requested</th>
                    <th scope="col" className="p-3 font-medium">Already reserved</th>
                    <th scope="col" className="p-3 font-medium">Available</th>
                    <th scope="col" className="p-3 font-medium">Shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {availability.lines.map((line) => (
                    <tr key={line.lineId} className="border-b border-[var(--border)] align-top last:border-b-0">
                      <td className="p-3">{line.equipmentName}</td>
                      <td className="p-3">{line.requested}</td>
                      <td className="p-3">{line.alreadyReserved}</td>
                      <td className="p-3">
                        {line.available}
                        {line.available === 0 ? (
                          <span className="block text-xs font-medium text-[var(--danger)]">
                            Unavailable for this window
                          </span>
                        ) : null}
                      </td>
                      <td className={`p-3 ${line.shortfall > 0 ? 'font-medium text-[var(--danger)]' : ''}`}>
                        {line.shortfall}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
