'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fieldErrorsFrom, type FieldErrors } from '@/components/equipment/fieldErrors';
import { quantityToSend } from '@/components/equipment/quantityInput';

/**
 * SCRUM-173: reserve units of one line's item for the event's commitment
 * window. Starts at what the line still needs; the server decides whether that
 * many are free (AC4) and says how many are when they are not.
 *
 * SCRUM-175: when fewer are available than asked, nothing is reserved; the
 * refusal says how many are available and the form offers to reserve those,
 * with the shortfall (AC1). With none available nothing is offered (AC3).
 *
 * After a reservation the page is refreshed, so the check, the reservations
 * and what is outstanding are read back from the stored rows. Rendered only
 * for Technical Support Staff (the page decides).
 */

type Offer = { quantity: number; shortfall: number };

/** SCRUM-175 AC1: the partial reservation the server offered with a refusal, if any. */
function offerFrom(details: unknown): Offer | null {
  if (typeof details !== 'object' || details === null) return null;
  const offer = (details as { offer?: unknown }).offer;
  if (typeof offer !== 'object' || offer === null) return null;
  const { quantity, shortfall } = offer as { quantity?: unknown; shortfall?: unknown };
  return typeof quantity === 'number' && typeof shortfall === 'number' ? { quantity, shortfall } : null;
}

export default function ReserveEquipmentForm({
  eventRequestId,
  lineId,
  equipmentName,
  toReserve,
}: {
  eventRequestId: string;
  lineId: string;
  equipmentName: string;
  toReserve: number;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(toReserve));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [offer, setOffer] = useState<Offer | null>(null);

  async function reserve(toSend: number | string | undefined) {
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setOffer(null);
    try {
      const response = await fetch(
        `/api/event-requests/${eventRequestId}/equipment-request/lines/${lineId}/reservation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: toSend }),
        },
      );
      if (response.ok) {
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => null)) as { message?: string; details?: unknown } | null;
      setFieldErrors(fieldErrorsFrom(payload?.details));
      setError(payload?.message ?? 'The equipment could not be reserved.');
      setOffer(offerFrom(payload?.details));
    } catch {
      setError('The equipment could not be reserved.');
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    void reserve(quantityToSend(quantity));
  }

  const fieldError = fieldErrors.quantity?.join(' ');

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2">
      <label className="sr-only" htmlFor={`reserve-quantity-${lineId}`}>
        Quantity of {equipmentName} to reserve
      </label>
      <input
        id={`reserve-quantity-${lineId}`}
        type="text"
        inputMode="numeric"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
        className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
        aria-invalid={Boolean(fieldError)}
      />
      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Reserving...' : 'Reserve'}
      </button>
      {fieldError || error ? (
        <p role="alert" className="w-full text-sm text-[var(--danger)]">
          {fieldError ?? error}
        </p>
      ) : null}
      {/* SCRUM-175 AC1: the partial reservation, with what would still be short. */}
      {offer ? (
        <div className="w-full rounded-md border border-[var(--warning)] bg-amber-50 px-3 py-2 text-sm">
          <p>
            Reserve the {offer.quantity} available instead? {offer.shortfall} will still be short.
          </p>
          <button
            type="button"
            onClick={() => void reserve(offer.quantity)}
            disabled={submitting}
            className="mt-2 rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
          >
            Reserve {offer.quantity}
          </button>
        </div>
      ) : null}
    </form>
  );
}
