'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHANGE_REQUEST_FIELD_LABELS, type SelectableChangeRequestField } from '@/domain/change-request/schema';

/**
 * SCRUM-187 AC1 — "selecting each field to change, entering its proposed
 * value and giving a reason."
 *
 * Only the fields SELECTABLE_CHANGE_REQUEST_FIELDS actually allows are
 * offered, so the form can never submit a field the API would reject - see
 * that schema's comment for why the set is narrow for now (pending PO
 * confirmation of AC1's field scope).
 *
 * accessibilityFeatureIds and equipmentItems are left out of this form: both
 * need a catalogue picker (accessibility features, equipment lines) this
 * story does not build. The backend already accepts them
 * (SELECTABLE_CHANGE_REQUEST_FIELDS, change-request/schema.ts); add their
 * inputs here once a picker exists, rather than faking one with free text.
 */

type FieldKind = 'date' | 'time' | 'number' | 'text' | 'boolean';

const FIELD_DEFS: { field: SelectableChangeRequestField; kind: FieldKind }[] = [
  { field: 'proposedDate', kind: 'date' },
  { field: 'startTime', kind: 'time' },
  { field: 'endTime', kind: 'time' },
  { field: 'expectedAttendance', kind: 'number' },
  { field: 'roomLayout', kind: 'text' },
  { field: 'accessibilityRequired', kind: 'boolean' },
  { field: 'accessibilityNotes', kind: 'text' },
  { field: 'preferredLocationId', kind: 'text' },
  { field: 'equipmentRequired', kind: 'boolean' },
  { field: 'technicalSupportNotes', kind: 'text' },
];

function parseValue(kind: FieldKind, raw: string): unknown {
  if (kind === 'number') return raw === '' ? null : Number(raw);
  if (kind === 'boolean') return raw === 'true';
  return raw === '' ? null : raw;
}

export function ChangeRequestForm({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<SelectableChangeRequestField>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleField(field: SelectableChangeRequestField) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const fields = FIELD_DEFS.filter((def) => selected.has(def.field)).map((def) => ({
        field: def.field,
        proposedValue: parseValue(def.kind, values[def.field] ?? ''),
      }));

      const result = await fetch(`/api/event-requests/${requestId}/change-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields, reason }),
      });
      const payload = (await result.json().catch(() => null)) as { message?: string } | null;
      if (!result.ok) {
        throw new Error(payload?.message ?? 'The change request could not be sent.');
      }

      setOpen(false);
      setSelected(new Set());
      setValues({});
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change request could not be sent.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
      >
        Request a change
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div>
        <p className="text-sm font-medium">Select each field to change</p>
        <div className="mt-2 space-y-3">
          {FIELD_DEFS.map((def) => (
            <div key={def.field} className="flex items-start gap-3">
              <input
                type="checkbox"
                id={`field-${def.field}`}
                checked={selected.has(def.field)}
                onChange={() => toggleField(def.field)}
                className="mt-1"
              />
              <div className="flex-1">
                <label htmlFor={`field-${def.field}`} className="block text-sm font-medium">
                  {CHANGE_REQUEST_FIELD_LABELS[def.field]}
                </label>
                {selected.has(def.field) ? (
                  def.kind === 'boolean' ? (
                    <select
                      value={values[def.field] ?? ''}
                      onChange={(event) => setValues((v) => ({ ...v, [def.field]: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
                    >
                      <option value="">Choose...</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : (
                    <input
                      type={def.kind === 'date' ? 'date' : def.kind === 'time' ? 'time' : def.kind === 'number' ? 'number' : 'text'}
                      // SCRUM-258: 31 Dec 9999 is the latest valid date, so the
                      // picker stops there instead of letting a stray keystroke
                      // roll the year segment past 4 digits.
                      max={def.kind === 'date' ? '9999-12-31' : undefined}
                      value={values[def.field] ?? ''}
                      onChange={(event) => setValues((v) => ({ ...v, [def.field]: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
                      placeholder="Proposed value"
                    />
                  )
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="change-request-reason" className="block text-sm font-medium">
          Reason
        </label>
        <textarea
          id="change-request-reason"
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm"
          placeholder="Why is this change needed?"
        />
      </div>

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting || selected.size === 0}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {submitting ? 'Sending...' : 'Send change request'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
