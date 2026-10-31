'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CHANGE_REQUEST_FIELD_LABELS, type SelectableChangeRequestField } from '@/domain/change-request/schema';
import { refusalMessage, type ChangeRequestRefusal } from './refusalMessage';

/**
 * SCRUM-187 AC1 — "selecting each field to change, entering its proposed
 * value and giving a reason."
 *
 * Every field SELECTABLE_CHANGE_REQUEST_FIELDS allows is offered, in the same
 * order - the full event-request field set, per CL-61 (24 Oct 2026).
 *
 * SCRUM-274: Accessibility features and Equipment items are offered too, with
 * the same pickers as the event request form (SCRUM-79/80): a checkbox per
 * accessibility feature on the list, and rows of an item name and a quantity.
 * Each is proposed as a whole new list.
 */

type FieldKind = 'date' | 'time' | 'number' | 'text' | 'longText' | 'boolean' | 'features' | 'equipment';

/** One equipment row as typed: the quantity stays text until it is sent. */
export interface EquipmentRowInput {
  item: string;
  quantity: string;
}

export const CHANGE_REQUEST_FORM_FIELDS: { field: SelectableChangeRequestField; kind: FieldKind }[] = [
  { field: 'name', kind: 'text' },
  { field: 'purpose', kind: 'longText' },
  { field: 'description', kind: 'longText' },
  { field: 'proposedDate', kind: 'date' },
  { field: 'startTime', kind: 'time' },
  { field: 'endTime', kind: 'time' },
  { field: 'expectedAttendance', kind: 'number' },
  { field: 'roomLayout', kind: 'text' },
  { field: 'accessibilityRequired', kind: 'boolean' },
  { field: 'accessibilityFeatureIds', kind: 'features' },
  { field: 'accessibilityNotes', kind: 'text' },
  { field: 'preferredLocationId', kind: 'text' },
  { field: 'equipmentRequired', kind: 'boolean' },
  { field: 'equipmentItems', kind: 'equipment' },
  { field: 'technicalSupportNotes', kind: 'text' },
  { field: 'registrationRequired', kind: 'boolean' },
];

const FIELD_DEFS = CHANGE_REQUEST_FORM_FIELDS;

function parseValue(kind: FieldKind, raw: string): unknown {
  if (kind === 'number') return raw === '' ? null : Number(raw);
  if (kind === 'boolean') return raw === 'true';
  return raw === '' ? null : raw;
}

/**
 * SCRUM-274: the proposed equipment list. Blank rows are dropped; a quantity
 * is sent as a number, so the API's rule (a whole number above 0) can refuse
 * it with its own message.
 */
export function toProposedEquipmentItems(rows: readonly EquipmentRowInput[]): { item: string; quantity: number }[] {
  return rows
    .filter((row) => row.item.trim() !== '' || row.quantity.trim() !== '')
    .map((row) => ({ item: row.item.trim(), quantity: row.quantity.trim() === '' ? 0 : Number(row.quantity) }));
}

export function ChangeRequestForm({
  requestId,
  accessibilityFeatures,
}: {
  requestId: string;
  /** SCRUM-274: the accessibility features list (id and name), for the picker. */
  accessibilityFeatures: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<SelectableChangeRequestField>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [featureIds, setFeatureIds] = useState<string[]>([]);
  const [equipmentRows, setEquipmentRows] = useState<EquipmentRowInput[]>([{ item: '', quantity: '' }]);
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
        proposedValue:
          def.kind === 'features'
            ? featureIds
            : def.kind === 'equipment'
              ? toProposedEquipmentItems(equipmentRows)
              : parseValue(def.kind, values[def.field] ?? ''),
      }));

      const result = await fetch(`/api/event-requests/${requestId}/change-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields, reason }),
      });
      const payload = (await result.json().catch(() => null)) as ChangeRequestRefusal;
      if (!result.ok) {
        // SCRUM-273: the reason on the field, not "The change request is not valid."
        throw new Error(refusalMessage(payload));
      }

      setOpen(false);
      setSelected(new Set());
      setValues({});
      setFeatureIds([]);
      setEquipmentRows([{ item: '', quantity: '' }]);
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
                  def.kind === 'features' ? (
                    <FeaturePicker
                      features={accessibilityFeatures}
                      chosen={featureIds}
                      onToggle={(id) =>
                        setFeatureIds((current) =>
                          current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
                        )
                      }
                    />
                  ) : def.kind === 'equipment' ? (
                    <EquipmentRows rows={equipmentRows} onChange={setEquipmentRows} />
                  ) : def.kind === 'boolean' ? (
                    <select
                      value={values[def.field] ?? ''}
                      onChange={(event) => setValues((v) => ({ ...v, [def.field]: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
                    >
                      <option value="">Choose...</option>
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  ) : def.kind === 'longText' ? (
                    <textarea
                      rows={3}
                      value={values[def.field] ?? ''}
                      onChange={(event) => setValues((v) => ({ ...v, [def.field]: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
                      placeholder="Proposed value"
                    />
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

/** SCRUM-274: a checkbox per accessibility feature, as in the event request form. */
function FeaturePicker({
  features,
  chosen,
  onToggle,
}: {
  features: readonly { id: string; name: string }[];
  chosen: readonly string[];
  onToggle: (id: string) => void;
}) {
  if (features.length === 0) {
    return <p className="mt-1 text-xs text-[var(--text-muted)]">No accessibility features are on the list yet.</p>;
  }
  return (
    <div className="mt-1 flex flex-wrap gap-x-6 gap-y-2">
      {features.map((feature) => (
        <label key={feature.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={chosen.includes(feature.id)} onChange={() => onToggle(feature.id)} />
          {feature.name}
        </label>
      ))}
    </div>
  );
}

/** SCRUM-274: rows of an item name and a quantity, as in the event request form. */
function EquipmentRows({
  rows,
  onChange,
}: {
  rows: readonly EquipmentRowInput[];
  onChange: (rows: EquipmentRowInput[]) => void;
}) {
  const update = (index: number, change: Partial<EquipmentRowInput>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)));
  return (
    <div className="mt-1 space-y-2">
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <label className="min-w-[10rem] flex-1 text-xs">
            Item
            <input
              value={row.item}
              maxLength={100}
              placeholder="e.g. Wireless microphone"
              onChange={(event) => update(index, { item: event.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
            />
          </label>
          <label className="w-24 text-xs">
            Quantity
            <input
              type="number"
              min={1}
              step={1}
              value={row.quantity}
              onChange={(event) => update(index, { quantity: event.target.value })}
              className="mt-1 w-full rounded-md border border-[var(--border)] bg-white px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            aria-label={`Remove equipment item ${index + 1}`}
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { item: '', quantity: '' }])}
        className="rounded-md border border-[var(--border)] bg-white px-3 py-1 text-sm font-medium hover:bg-slate-50"
      >
        Add item
      </button>
    </div>
  );
}
