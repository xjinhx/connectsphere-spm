'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EVENT_INFORMATION_FIELDS,
  EVENT_INFORMATION_LABELS,
  type EventInformationField,
  type EventInformationView,
} from '@/domain/event-information/schema';

/**
 * SCRUM-110 — the event's ordinary information on the coordinator's page.
 *
 * AC1: the assigned coordinator opens "Edit event information", changes any of
 * the five fields and saves; the page re-reads them from the database. Nothing
 * else on the page changes, because this save flags no arrangement. AC5: on a
 * Completed or Cancelled event the fields are shown read-only with the reason.
 * A coordinator who is not assigned (or the Lead) sees the values only.
 *
 * The API refuses every case the page hides the action for; hiding it only
 * keeps the page from offering an edit it would refuse.
 */

type FormValues = Record<EventInformationField, string>;

const MULTILINE: ReadonlySet<EventInformationField> = new Set(['description', 'internalNotes']);
const INPUT_TYPE: Partial<Record<EventInformationField, string>> = { clientContactEmail: 'email', clientContactPhone: 'tel' };

function toForm(view: EventInformationView): FormValues {
  return {
    description: view.description,
    internalNotes: view.internalNotes ?? '',
    clientContactName: view.clientContactName ?? '',
    clientContactEmail: view.clientContactEmail ?? '',
    clientContactPhone: view.clientContactPhone ?? '',
  };
}

function shown(value: string | null): string {
  return value && value.trim() !== '' ? value : 'Not provided';
}

export function EventInformationPanel({ requestId, view }: { requestId: string; view: EventInformationView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FormValues>(() => toForm(view));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<EventInformationField, string>>>({});
  const [saved, setSaved] = useState(false);

  function startEditing() {
    setValues(toForm(view));
    setError(null);
    setFieldErrors({});
    setSaved(false);
    setEditing(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/event-requests/${requestId}/information`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        details?: { fieldErrors?: Partial<Record<EventInformationField, string[]>> };
      } | null;
      if (!response.ok) {
        const perField = Object.fromEntries(
          Object.entries(payload?.details?.fieldErrors ?? {}).flatMap(([field, messages]) =>
            messages?.[0] ? [[field, messages[0]]] : [],
          ),
        );
        setFieldErrors(perField);
        // A named field already shows its own message; don't repeat it below.
        throw new Error(
          Object.keys(perField).length > 0
            ? 'Nothing was saved. Correct the highlighted field and save again.'
            : (payload?.message ?? 'The event information could not be saved.'),
        );
      }
      setSaved(true);
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The event information could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Event information</h2>
        {view.canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Edit event information
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
          {EVENT_INFORMATION_FIELDS.map((field) => {
            const id = `event-information-${field}`;
            const invalid = Boolean(fieldErrors[field]);
            const common = {
              id,
              name: field,
              value: values[field],
              'aria-invalid': invalid,
              'aria-describedby': invalid ? `${id}-error` : undefined,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                setValues({ ...values, [field]: e.target.value });
                setSaved(false);
              },
              className: `w-full rounded-md border px-3 py-2 text-sm ${invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]'}`,
            };
            return (
              <div key={field}>
                <label htmlFor={id} className="block text-sm font-medium">
                  {EVENT_INFORMATION_LABELS[field]}
                  {field === 'description' ? ' *' : ''}
                </label>
                {MULTILINE.has(field) ? (
                  <textarea rows={3} {...common} />
                ) : (
                  <input type={INPUT_TYPE[field] ?? 'text'} {...common} />
                )}
                {invalid ? (
                  <p id={`${id}-error`} className="mt-1 text-xs text-[var(--danger)]">
                    {fieldErrors[field]}
                  </p>
                ) : null}
              </div>
            );
          })}

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-2">
          {EVENT_INFORMATION_FIELDS.map((field) => (
            <div key={field} className="border-b border-[var(--border)] py-2 last:border-b-0">
              <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                {EVENT_INFORMATION_LABELS[field]}
              </dt>
              <dd className="mt-1 text-sm whitespace-pre-wrap">{shown(view[field])}</dd>
            </div>
          ))}
        </dl>
      )}

      {saved && !editing ? <p className="mt-2 text-sm text-[var(--text-muted)]">Event information saved.</p> : null}
      {view.readOnlyReason ? <p className="mt-2 text-xs text-[var(--text-muted)]">{view.readOnlyReason}</p> : null}
    </section>
  );
}
