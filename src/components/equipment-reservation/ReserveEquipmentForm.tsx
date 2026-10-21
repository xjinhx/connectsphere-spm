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
 * After a reservation the page is refreshed, so the check, the reservations
 * and what is outstanding are read back from the stored rows. Rendered only
 * for Technical Support Staff (the page decides).
 */
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(
        `/api/event-requests/${eventRequestId}/equipment-request/lines/${lineId}/reservation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quantity: quantityToSend(quantity) }),
        },
      );
      if (response.ok) {
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => null)) as { message?: string; details?: unknown } | null;
      setFieldErrors(fieldErrorsFrom(payload?.details));
      setError(payload?.message ?? 'The equipment could not be reserved.');
    } catch {
      setError('The equipment could not be reserved.');
    } finally {
      setSubmitting(false);
    }
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
    </form>
  );
}
