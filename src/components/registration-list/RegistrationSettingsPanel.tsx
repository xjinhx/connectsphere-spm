'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  REGISTRATION_SETTINGS_FIELDS,
  REGISTRATION_SETTINGS_LABELS,
  type RegistrationSettingsField,
  type RegistrationSettingsView,
} from '@/domain/registration-list/schema';
import { formatDayMonthYear, LATEST_DATE } from '@/domain/shared/dates';

/**
 * SCRUM-185 AC5, AC6 — the registration start date, end date and capacity on
 * the event's registration page.
 *
 * AC5: the assigned coordinator of a Confirmed event opens "Set registration",
 * enters the three and saves; the page re-reads them from the database. AC6:
 * a refused save names the field. Anyone else who can open the page sees the
 * values only.
 *
 * The API refuses every case the page hides the action for; hiding it only
 * keeps the page from offering a save it would refuse.
 */

type FormValues = Record<RegistrationSettingsField, string>;

function toForm(view: RegistrationSettingsView): FormValues {
  return {
    startDate: view.startDate ?? '',
    endDate: view.endDate ?? '',
    capacity: view.capacity === null ? '' : String(view.capacity),
  };
}

function shown(view: RegistrationSettingsView, field: RegistrationSettingsField): string {
  const value = view[field];
  if (value === null) return 'Not set';
  return field === 'capacity' ? String(value) : formatDayMonthYear(String(value));
}

export function RegistrationSettingsPanel({ view }: { view: RegistrationSettingsView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FormValues>(() => toForm(view));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RegistrationSettingsField, string>>>({});
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
      const response = await fetch(`/api/event-requests/${view.eventRequestId}/registration-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
        details?: { fieldErrors?: Partial<Record<RegistrationSettingsField, string[]>> };
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
            : (payload?.message ?? 'The registration settings could not be saved.'),
        );
      }
      setSaved(true);
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The registration settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Registration</h2>
        {view.canEdit && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Set registration
          </button>
        ) : null}
      </div>

      {editing ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
          {REGISTRATION_SETTINGS_FIELDS.map((field) => {
            const id = `registration-${field}`;
            const invalid = Boolean(fieldErrors[field]);
            return (
              <div key={field}>
                <label htmlFor={id} className="block text-sm font-medium">
                  {REGISTRATION_SETTINGS_LABELS[field]} *
                </label>
                <input
                  id={id}
                  name={field}
                  type={field === 'capacity' ? 'number' : 'date'}
                  min={field === 'capacity' ? 1 : undefined}
                  max={field === 'capacity' ? undefined : LATEST_DATE}
                  inputMode={field === 'capacity' ? 'numeric' : undefined}
                  value={values[field]}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${id}-error` : undefined}
                  onChange={(e) => {
                    setValues({ ...values, [field]: e.target.value });
                    setSaved(false);
                  }}
                  className={`w-full rounded-md border px-3 py-2 text-sm ${invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]'}`}
                />
                {field === 'capacity' && view.largestVenueCapacity !== null ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    At most {view.largestVenueCapacity}, the largest capacity of this event&apos;s venues.
                  </p>
                ) : null}
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
          {REGISTRATION_SETTINGS_FIELDS.map((field) => (
            <div key={field} className="border-b border-[var(--border)] py-2 last:border-b-0">
              <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                {REGISTRATION_SETTINGS_LABELS[field]}
              </dt>
              <dd className="mt-1 text-sm" data-testid={`registration-${field}`}>
                {shown(view, field)}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {saved && !editing ? <p className="mt-2 text-sm text-[var(--text-muted)]">Registration saved.</p> : null}
      {view.readOnlyReason ? <p className="mt-2 text-xs text-[var(--text-muted)]">{view.readOnlyReason}</p> : null}
    </section>
  );
}
