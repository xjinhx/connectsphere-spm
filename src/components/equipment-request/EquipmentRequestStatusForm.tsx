'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EQUIPMENT_REQUEST_STATUSES,
  EQUIPMENT_REQUEST_STATUS_LABELS,
  UNABLE_REASON_MAX_LENGTH,
  type EquipmentRequestStatus,
} from '@/domain/equipment-request/schema';

/**
 * SCRUM-166 — Technical Support Staff set an equipment request's status.
 *
 * AC2: choose the status and save; who and when are recorded by the server
 * from the signed-in account. AC3: partially fulfilled shows the request's
 * lines to mark unavailable. AC4: unable to fulfil asks for the reason. The
 * server checks both before saving (it is the rule, not this form), and its
 * message is shown next to the field it names.
 *
 * After a save the page is refreshed, so what is shown is read back from the
 * stored request. Rendered only for Technical Support Staff (view.canSetStatus).
 */

type Line = { id: string; equipmentName: string; quantity: number; unavailable: boolean };
type FieldErrors = Partial<Record<'status' | 'unavailableLineIds' | 'reason', string>>;

export default function EquipmentRequestStatusForm({
  eventRequestId,
  status,
  unableReason,
  lines,
}: {
  eventRequestId: string;
  status: EquipmentRequestStatus;
  unableReason: string | null;
  lines: Line[];
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<EquipmentRequestStatus>(status);
  const [unavailable, setUnavailable] = useState<string[]>(
    lines.filter((line) => line.unavailable).map((line) => line.id),
  );
  const [reason, setReason] = useState(unableReason ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState(false);

  function toggle(lineId: string) {
    setSaved(false);
    setUnavailable((current) =>
      current.includes(lineId) ? current.filter((id) => id !== lineId) : [...current, lineId],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const response = await fetch(`/api/event-requests/${eventRequestId}/equipment-request/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: chosen, unavailableLineIds: unavailable, reason }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          message?: string;
          details?: { fieldErrors?: Record<string, string[] | undefined> };
        } | null;
        const fields = payload?.details?.fieldErrors ?? {};
        setFieldErrors({
          status: fields.status?.[0],
          unavailableLineIds: fields.unavailableLineIds?.[0],
          reason: fields.reason?.[0],
        });
        throw new Error(payload?.message ?? 'The status could not be saved.');
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The status could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="equipment-request-status" className="text-sm font-medium">
          Status
        </label>
        <select
          id="equipment-request-status"
          value={chosen}
          onChange={(event) => {
            setChosen(event.target.value as EquipmentRequestStatus);
            setSaved(false);
          }}
          className="w-fit rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {EQUIPMENT_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {EQUIPMENT_REQUEST_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      {chosen === 'partially_fulfilled' ? (
        // AC3: every unavailable item is identified before saving.
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">Unavailable items</legend>
          <p className="text-xs text-[var(--text-muted)]">Tick every item that cannot be provided.</p>
          {lines.map((line) => (
            <label key={line.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={unavailable.includes(line.id)} onChange={() => toggle(line.id)} />
              {line.equipmentName} × {line.quantity}
            </label>
          ))}
          {fieldErrors.unavailableLineIds ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {fieldErrors.unavailableLineIds}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {chosen === 'unable_to_fulfil' ? (
        // AC4: a reason is mandatory.
        <div className="flex flex-col gap-1">
          <label htmlFor="equipment-request-reason" className="text-sm font-medium">
            Reason (required)
          </label>
          <textarea
            id="equipment-request-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setSaved(false);
            }}
            rows={3}
            maxLength={UNABLE_REASON_MAX_LENGTH}
            aria-invalid={fieldErrors.reason ? true : undefined}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          {fieldErrors.reason ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {fieldErrors.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save status'}
      </button>
      {error && !fieldErrors.unavailableLineIds && !fieldErrors.reason ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="text-sm text-[var(--success)]">
          Saved.
        </p>
      ) : null}
    </form>
  );
}
