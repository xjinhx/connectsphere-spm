'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fieldErrorsFrom, type FieldErrors } from '@/components/equipment/fieldErrors';
import { quantityToSend } from '@/components/equipment/quantityInput';
import {
  EQUIPMENT_CATEGORY_LABELS,
  OPERATIONAL_STATUS_LABELS,
  type EquipmentOption,
} from '@/domain/equipment/schema';
import type { AddEquipmentLineOutcome, EquipmentRequestLine } from '@/domain/equipment-request/schema';

/**
 * SCRUM-160: add an equipment type and a quantity to the event's request.
 *
 * AC1: the type is chosen from the equipment catalogue (SCRUM-240 AC5) - every
 *      item it holds, whatever its operational status, which is shown beside
 *      it - and the line is saved against the event's request. A missing type
 *      is named on its field (TC-160-03).
 * AC2: a quantity of zero or below is refused and the field says it must be at
 *      least one (TC-160-04); the server decides, the form only shows it.
 * AC3: when the type is already on the request, the new line is still added on
 *      its own and the existing lines are shown, so the coordinator can merge
 *      them by hand if they meant to (TC-160-07). Nothing is merged for them.
 *
 * After a save the page is refreshed, so the list is read back from the stored
 * rows (TC-160-01). Rendered only for the event's assigned coordinator while
 * the event is open to it (the page decides, with request.canEdit).
 */

export default function AddEquipmentLineForm({
  eventRequestId,
  options,
}: {
  eventRequestId: string;
  options: EquipmentOption[];
}) {
  const router = useRouter();
  const [equipmentId, setEquipmentId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [sameType, setSameType] = useState<{ added: EquipmentRequestLine; existing: EquipmentRequestLine[] } | null>(
    null,
  );

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setSameType(null);
    try {
      const response = await fetch(`/api/event-requests/${eventRequestId}/equipment-request/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(equipmentId ? { equipmentId } : {}),
          quantity: quantityToSend(quantity),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (Partial<AddEquipmentLineOutcome> & { message?: string; details?: unknown })
        | null;
      if (!response.ok) {
        setFieldErrors(fieldErrorsFrom(payload?.details));
        throw new Error(payload?.message ?? 'The equipment item could not be saved.');
      }
      if (payload?.line && payload.sameTypeLines && payload.sameTypeLines.length > 0) {
        setSameType({ added: payload.line, existing: payload.sameTypeLines });
      }
      setEquipmentId('');
      setQuantity('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The equipment item could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-60 flex-1 flex-col gap-1">
          <label htmlFor="equipment-type" className="text-sm font-medium">
            Equipment type
          </label>
          <select
            id="equipment-type"
            value={equipmentId}
            onChange={(event) => setEquipmentId(event.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(fieldErrors.equipmentId?.length)}
          >
            <option value="">Choose an item from the catalogue</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({EQUIPMENT_CATEGORY_LABELS[option.category]},{' '}
                {OPERATIONAL_STATUS_LABELS[option.operationalStatus]})
              </option>
            ))}
          </select>
          {fieldErrors.equipmentId?.length ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {fieldErrors.equipmentId.join(' ')}
            </p>
          ) : null}
        </div>

        <div className="flex w-28 flex-col gap-1">
          <label htmlFor="equipment-quantity" className="text-sm font-medium">
            Quantity
          </label>
          <input
            id="equipment-quantity"
            type="text"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={fieldClass}
            aria-invalid={Boolean(fieldErrors.quantity?.length)}
          />
          {fieldErrors.quantity?.length ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {fieldErrors.quantity.join(' ')}
            </p>
          ) : null}
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Adding...' : 'Add item'}
      </button>

      {/* The summary repeats the field error, so show it only when no field owns the problem. */}
      {error && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {/* AC3: the existing lines of the same type, shown after the new one is saved. */}
      {sameType ? (
        <div role="status" className="rounded-md border border-[var(--warning)] bg-amber-50 px-3 py-2 text-sm">
          <p className="font-medium">
            Added {sameType.added.equipmentName} × {sameType.added.quantity} as a separate line. This request already
            has:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {sameType.existing.map((line) => (
              <li key={line.id}>
                {line.equipmentName} × {line.quantity}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[var(--text-muted)]">
            Lines are never merged for you. To merge them, change one line&apos;s quantity and remove the other.
          </p>
        </div>
      ) : null}
    </form>
  );
}
