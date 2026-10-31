import { formatWindow } from '@/components/equipment-reservation/EquipmentAvailabilitySection';
import { ReleaseReservationForm } from '@/components/equipment-reservation/ReleaseReservationForm';
import ReserveEquipmentForm from '@/components/equipment-reservation/ReserveEquipmentForm';
import { RESERVATION_STATUS_LABELS, type EventReservations } from '@/domain/equipment-reservation/schema';
import { formatDayMonthYear, formatSingaporeDateTime, toSingaporeISODate } from '@/domain/shared/dates';

/**
 * SCRUM-173 AC6, AC7: the event's equipment section.
 *
 * AC6 every reservation with its item, quantity, window and status.
 * AC7 what is still to reserve, listed on its own; a fully reserved line is
 *     not listed. Technical Support Staff reserve from here (AC1): each
 *     outstanding line has a Reserve form, refused when the event has no
 *     approved venue booking (AC2) or not enough is available (AC4).
 *
 * SCRUM-111 AC7: a reservation flagged by a change to the event's date or
 * times shows Review required, with the cause and when it was set.
 *
 * SCRUM-177: Technical Support Staff release each Reserved row, with a reason
 * (AC1); a Released row shows its reason and date to everyone who can open
 * the page, the coordinator included (AC5).
 */
export function EventReservationsSection({
  eventRequestId,
  reservations,
  outstanding,
  canReserve,
  canRelease,
}: EventReservations & { canReserve: boolean; canRelease: boolean }) {
  return (
    <>
      <section className="mt-6" aria-labelledby="reservations-heading">
        <h2 id="reservations-heading" className="text-sm font-semibold">
          Reservations
        </h2>
        {reservations.length === 0 ? (
          <p className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
            Nothing has been reserved for this event yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th scope="col" className="p-3 font-medium">Item</th>
                  <th scope="col" className="p-3 font-medium">Quantity</th>
                  <th scope="col" className="p-3 font-medium">Window</th>
                  <th scope="col" className="p-3 font-medium">Status</th>
                  {canRelease ? <th scope="col" className="p-3 font-medium">Release</th> : null}
                </tr>
              </thead>
              <tbody>
                {reservations.map((reservation) => (
                  <tr key={reservation.id} className="border-b border-[var(--border)] align-top last:border-b-0">
                    <td className="p-3">{reservation.equipmentName}</td>
                    <td className="p-3">{reservation.quantity}</td>
                    <td className="p-3">{formatWindow(reservation.window)}</td>
                    <td className="p-3">
                      {RESERVATION_STATUS_LABELS[reservation.status]}
                      {reservation.reviewRequired ? (
                        <p className="mt-1 text-xs text-[var(--warning)]">
                          <span className="font-medium">Review required:</span> {reservation.reviewRequiredCause}
                          {reservation.reviewRequiredAt
                            ? ` (${formatSingaporeDateTime(reservation.reviewRequiredAt)})`
                            : ''}
                        </p>
                      ) : null}
                      {reservation.status === 'released' ? (
                        <p className="mt-1 text-xs text-[var(--text-muted)]">
                          {reservation.releasedAt
                            ? `Released on ${formatDayMonthYear(toSingaporeISODate(new Date(reservation.releasedAt)))}. `
                            : ''}
                          <span className="font-medium">Reason:</span> {reservation.releaseReason}
                        </p>
                      ) : null}
                    </td>
                    {canRelease ? (
                      <td className="p-3">
                        {reservation.status === 'reserved' ? (
                          <ReleaseReservationForm eventRequestId={eventRequestId} reservationId={reservation.id} />
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6" aria-labelledby="outstanding-heading">
        <h2 id="outstanding-heading" className="text-sm font-semibold">
          Outstanding
        </h2>
        {outstanding.length === 0 ? (
          <p className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
            Nothing outstanding: every requested item is reserved.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th scope="col" className="p-3 font-medium">Item</th>
                  <th scope="col" className="p-3 font-medium">Requested</th>
                  <th scope="col" className="p-3 font-medium">Reserved</th>
                  <th scope="col" className="p-3 font-medium">Outstanding</th>
                  {canReserve ? <th scope="col" className="p-3 font-medium">Reserve</th> : null}
                </tr>
              </thead>
              <tbody>
                {outstanding.map((line) => (
                  <tr key={line.lineId} className="border-b border-[var(--border)] align-top last:border-b-0">
                    <td className="p-3">{line.equipmentName}</td>
                    <td className="p-3">{line.requested}</td>
                    <td className="p-3">{line.reserved}</td>
                    <td className="p-3 font-medium">{line.outstanding}</td>
                    {canReserve ? (
                      <td className="p-3">
                        {/* Keyed on what is outstanding, so the box resets after a reservation. */}
                        <ReserveEquipmentForm
                          key={`${line.lineId}-${line.outstanding}`}
                          eventRequestId={eventRequestId}
                          lineId={line.lineId}
                          equipmentName={line.equipmentName}
                          toReserve={line.outstanding}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
