'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  OPERATIONAL_STATUS_LABELS,
  type EquipmentItem,
  type OperationalStatus,
} from '@/domain/equipment/schema';
import { quantityToSend } from './quantityInput';
import { fieldErrorsFrom, type FieldErrors } from './fieldErrors';

/**
 * SCRUM-240 AC2 and AC4: change one catalogue item's operational status and
 * quantity.
 *
 * AC2: the status is one of the four (OPERATIONAL_STATUS_LABELS), and the
 *      saved value is read back from the stored row - the page is refreshed
 *      after a save, so the list is the server's and not a cached copy
 *      (TC-240-04).
 * AC4: the quantity rule holds on an edit as well as on an add, so -2 is
 *      refused with the field identified and the stored quantity left as it
 *      was (TC-240-12), and 6 is accepted (TC-240-13).
 *
 * Only the fields that actually changed are sent, so changing the status does
 * not rewrite the name, quantity or location (TC-240-06).
 *
 * This renders only for roles that may maintain the catalogue (AC3): the page
 * decides, with canManageEquipment.
 */

const STATUSES = Object.entries(OPERATIONAL_STATUS_LABELS) as [OperationalStatus, string][];

export default function EquipmentRowEditor({ item }: { item: EquipmentItem }) {
  const router = useRouter();
  const [status, setStatus] = useState<OperationalStatus>(item.operationalStatus);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);

  const quantityChanged = quantity.trim() !== String(item.quantity);
  const statusChanged = status !== item.operationalStatus;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const response = await fetch(`/api/equipment/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(statusChanged ? { operationalStatus: status } : {}),
          ...(quantityChanged ? { quantity: quantityToSend(quantity) } : {}),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; details?: unknown }
        | null;
      if (!response.ok) {
        setFieldErrors(fieldErrorsFrom(payload?.details));
        throw new Error(payload?.message ?? 'The change could not be saved.');
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      // The stored row is unchanged, so put the boxes back to what it holds.
      setStatus(item.operationalStatus);
      setQuantity(String(item.quantity));
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm';

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2">
      <label className="sr-only" htmlFor={`status-${item.id}`}>
        Operational status for {item.name}
      </label>
      <select
        id={`status-${item.id}`}
        value={status}
        onChange={(event) => setStatus(event.target.value as OperationalStatus)}
        className={fieldClass}
      >
        {STATUSES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div>
        <label className="sr-only" htmlFor={`quantity-${item.id}`}>
          Quantity for {item.name}
        </label>
        <input
          id={`quantity-${item.id}`}
          type="text"
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
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
        disabled={submitting || (!statusChanged && !quantityChanged)}
        className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save'}
      </button>

      {/* The summary repeats the field error, so show it only when no field owns the problem. */}
      {error && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="w-full text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="w-full text-sm text-[var(--success)]">
          Saved.
        </p>
      ) : null}
    </form>
  );
}
