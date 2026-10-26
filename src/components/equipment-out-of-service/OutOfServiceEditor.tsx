'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fieldErrorsFrom, type FieldErrors } from '@/components/equipment/fieldErrors';
import { quantityToSend } from '@/components/equipment/quantityInput';
import {
  OUT_OF_SERVICE_LABELS,
  OUT_OF_SERVICE_STATUSES,
  type OutOfServiceCounts,
  type OutOfServiceStatus,
} from '@/domain/equipment-out-of-service/schema';

/**
 * SCRUM-170: record how many of one catalogue item's units are out of service,
 * by status.
 *
 * AC1 record a count as Unavailable, Damaged or Under maintenance and save.
 * AC2 return a unit to service by lowering its count and saving.
 * AC4 a count below zero, or counts adding up to more than the item has, are
 *     refused by the server with the field named; the boxes go back to what
 *     is stored.
 *
 * After a save the page is refreshed, so the counts are read back from the
 * stored row. Rendered only for Technical Support Staff (the page decides).
 */
export default function OutOfServiceEditor({
  equipmentId,
  equipmentName,
  counts,
}: {
  equipmentId: string;
  equipmentName: string;
  counts: OutOfServiceCounts;
}) {
  const router = useRouter();
  const stored = (status: OutOfServiceStatus) => String(counts[status]);
  const [values, setValues] = useState<Record<OutOfServiceStatus, string>>({
    unavailable: stored('unavailable'),
    damaged: stored('damaged'),
    underMaintenance: stored('underMaintenance'),
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const changed = OUT_OF_SERVICE_STATUSES.some((status) => values[status].trim() !== stored(status));

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/equipment/${equipmentId}/out-of-service`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unavailable: quantityToSend(values.unavailable),
          damaged: quantityToSend(values.damaged),
          underMaintenance: quantityToSend(values.underMaintenance),
        }),
      });
      if (response.ok) {
        router.refresh();
        return;
      }
      const payload = (await response.json().catch(() => null)) as { message?: string; details?: unknown } | null;
      setFieldErrors(fieldErrorsFrom(payload?.details));
      setError(payload?.message ?? 'The units out of service could not be saved.');
    } catch {
      setError('The units out of service could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-2">
      {OUT_OF_SERVICE_STATUSES.map((status) => {
        const id = `out-of-service-${status}-${equipmentId}`;
        const messages = fieldErrors[status];
        return (
          <div key={status} className="flex flex-col">
            <label htmlFor={id} className="text-xs text-[var(--text-muted)]">
              {OUT_OF_SERVICE_LABELS[status]}
              <span className="sr-only"> units of {equipmentName}</span>
            </label>
            <input
              id={id}
              type="text"
              inputMode="numeric"
              value={values[status]}
              onChange={(event) => setValues({ ...values, [status]: event.target.value })}
              className="w-16 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm"
              aria-invalid={Boolean(messages?.length)}
            />
            {messages?.length ? (
              <p role="alert" className="mt-1 max-w-[12rem] text-xs text-[var(--danger)]">
                {messages.join(' ')}
              </p>
            ) : null}
          </div>
        );
      })}
      <button
        type="submit"
        disabled={submitting || !changed}
        className="mt-4 rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save'}
      </button>
      {error && Object.keys(fieldErrors).length === 0 ? (
        <p role="alert" className="w-full text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
