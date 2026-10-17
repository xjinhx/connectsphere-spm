'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fieldErrorsFrom, type FieldErrors } from '@/components/equipment/fieldErrors';
import { quantityToSend } from '@/components/equipment/quantityInput';
import type { EquipmentRequestLine } from '@/domain/equipment-request/schema';

/**
 * SCRUM-160: change one line's quantity, or remove the line.
 *
 * AC7: for an item not yet reserved, either change is saved at once - one
 *      click, no confirmation step (TC-160-19, TC-160-20).
 * AC8: for a reserved item, a reduction comes back from the server as a 409
 *      with reservationConfirmationRequired. The warning is shown with Confirm
 *      and Cancel; Confirm sends the same change again with the confirmation,
 *      and Cancel sends nothing, so the stored line is left as it was
 *      (TC-160-21, TC-160-22). The server decides when to warn - the form does
 *      not guess from line.reserved - so the rule lives in one place.
 * AC2: a quantity of zero or below is refused on its field (TC-160-06).
 *
 * After a save the page is refreshed, so the list is read back from the
 * stored rows. Rendered only for the event's assigned coordinator while the
 * event is open to it (the page decides, with request.canEdit).
 */

type Pending = { kind: 'change'; quantity: number | string | undefined } | { kind: 'remove' };

export default function EquipmentLineEditor({
  eventRequestId,
  line,
}: {
  eventRequestId: string;
  line: EquipmentRequestLine;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // AC8: the change waiting for the coordinator to confirm the warning.
  const [awaitingConfirmation, setAwaitingConfirmation] = useState<{ pending: Pending; warning: string } | null>(null);

  const url = `/api/event-requests/${eventRequestId}/equipment-request/lines/${line.id}`;

  async function send(pending: Pending, confirmReservationChange: boolean) {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response =
        pending.kind === 'change'
          ? await fetch(url, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                quantity: pending.quantity,
                ...(confirmReservationChange ? { confirmReservationChange: true } : {}),
              }),
            })
          : await fetch(confirmReservationChange ? `${url}?confirmReservationChange=true` : url, { method: 'DELETE' });

      if (response.ok) {
        setAwaitingConfirmation(null);
        router.refresh();
        return;
      }

      const payload = (await response.json().catch(() => null)) as { message?: string; details?: unknown } | null;
      const details = payload?.details as { reservationConfirmationRequired?: boolean } | undefined;
      if (response.status === 409 && details?.reservationConfirmationRequired) {
        setAwaitingConfirmation({ pending, warning: payload?.message ?? 'This item has already been reserved.' });
        return;
      }
      setFieldErrors(fieldErrorsFrom(payload?.details));
      throw new Error(payload?.message ?? 'The change could not be saved.');
    } catch (caught) {
      // The stored line is unchanged, so put the box back to what it holds.
      setQuantity(String(line.quantity));
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  function onSave(event: React.FormEvent) {
    event.preventDefault();
    void send({ kind: 'change', quantity: quantityToSend(quantity) }, false);
  }

  function onCancel() {
    // Nothing is sent: the line stays as stored (TC-160-22).
    setAwaitingConfirmation(null);
    setQuantity(String(line.quantity));
  }

  const quantityChanged = quantity.trim() !== String(line.quantity);
  const fieldClass = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm';

  return (
    <form onSubmit={onSave} className="flex flex-wrap items-start gap-2">
      <div>
        <label className="sr-only" htmlFor={`line-quantity-${line.id}`}>
          Quantity for {line.equipmentName}
        </label>
        <input
          id={`line-quantity-${line.id}`}
          type="text"
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          disabled={awaitingConfirmation !== null}
          className={`${fieldClass} w-20`}
          aria-invalid={Boolean(fieldErrors.quantity?.length)}
        />
        {fieldErrors.quantity?.length ? (
          <p role="alert" className="mt-1 text-sm text-[var(--danger)]">
            {fieldErrors.quantity.join(' ')}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={submitting || !quantityChanged || awaitingConfirmation !== null}
        className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save'}
      </button>
      <button
        type="button"
        onClick={() => void send({ kind: 'remove' }, false)}
        disabled={submitting || awaitingConfirmation !== null}
        className="rounded-md border border-[var(--border)] px-3 py-1 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
      >
        Remove
      </button>

      {/* AC8: the reservation warning, with the choice to confirm or cancel. */}
      {awaitingConfirmation ? (
        <div role="alert" className="w-full rounded-md border border-[var(--warning)] bg-amber-50 px-3 py-2 text-sm">
          <p>{awaitingConfirmation.warning}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void send(awaitingConfirmation.pending, true)}
              disabled={submitting}
              className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
            >
              {submitting ? 'Saving...' : 'Confirm change'}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="rounded-md border border-[var(--border)] px-3 py-1 text-sm font-medium hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="w-full text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
