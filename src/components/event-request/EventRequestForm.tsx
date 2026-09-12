'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TIME_SLOT_LABELS, TIME_SLOT_ORDER, type TimeSlot } from '@/domain/event-request/schema';

/**
 * SCRUM-76 AC1 — the blank request form, with the client organisation already
 * filled in and not editable.
 *
 * Saving never checks the proposed date (AC3): an organiser may keep a request
 * with a date they still have to fix. The date rule is applied at submission
 * (SCRUM-82), which happens from the saved request's own page, not this form.
 *
 * SCRUM-77 AC4 — the slot picker is built from TIME_SLOT_ORDER, so the only
 * slots it can offer are the three that exist. Nothing crossing midnight can be
 * chosen because nothing crossing midnight is listed.
 */

const labelClass = 'block text-sm font-medium text-[var(--text)]';
const fieldClass =
  'mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ' +
  'focus:border-[var(--brand)] focus:outline-none';

export function EventRequestForm({
  clientOrganisation,
  today,
}: {
  clientOrganisation: { id: string; name: string };
  /** Today in Singapore, from the server, so the picker agrees with the rules. */
  today: string;
}) {
  const router = useRouter();

  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [description, setDescription] = useState('');
  const [proposedDate, setProposedDate] = useState('');
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSave() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      // Empty strings are sent as-is, not dropped: the schema's own message for
      // a blank field ("Purpose is required") is what names the missing field.
      const response = await fetch('/api/event-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, purpose, description, proposedDate, timeSlots }),
      });

      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      } | null;

      if (!response.ok || !payload?.id) {
        setFieldErrors(payload?.details?.fieldErrors ?? {});
        throw new Error(payload?.message ?? 'The request could not be saved.');
      }
      router.push(`/events/${payload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be saved.');
      setSaving(false);
    }
  }

  function toggleSlot(slot: TimeSlot) {
    setTimeSlots((current) =>
      current.includes(slot) ? current.filter((value) => value !== slot) : [...current, slot],
    );
  }

  function FieldError({ field }: { field: string }) {
    const messages = fieldErrors[field];
    if (!messages?.length) return null;
    return (
      <p className="mt-1 text-xs text-[var(--danger)]" role="alert">
        {messages[0]}
      </p>
    );
  }

  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <div>
        <label className={labelClass} htmlFor="organisation">
          Client organisation
        </label>
        <input
          id="organisation"
          className={`${fieldClass} bg-slate-50 text-[var(--text-muted)]`}
          value={clientOrganisation.name}
          readOnly
          aria-describedby="organisation-hint"
        />
        <p id="organisation-hint" className="mt-1 text-xs text-[var(--text-muted)]">
          Taken from your account. A request is always raised for your own organisation.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="name">
          Event name
        </label>
        <input
          id="name"
          className={fieldClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          required
        />
        <FieldError field="name" />
      </div>

      <div>
        <label className={labelClass} htmlFor="purpose">
          Purpose
        </label>
        <textarea
          id="purpose"
          className={fieldClass}
          rows={3}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
        <FieldError field="purpose" />
      </div>

      <div>
        <label className={labelClass} htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          className={fieldClass}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <FieldError field="description" />
      </div>

      <div>
        <label className={labelClass} htmlFor="proposedDate">
          Proposed date
        </label>
        <input
          id="proposedDate"
          type="date"
          className={fieldClass}
          value={proposedDate}
          min={today}
          onChange={(event) => setProposedDate(event.target.value)}
          aria-describedby="proposedDate-hint"
        />
        <p id="proposedDate-hint" className="mt-1 text-xs text-[var(--text-muted)]">
          Singapore time. Must be today or later to submit; any date can be saved.
        </p>
        <FieldError field="proposedDate" />
      </div>

      <fieldset>
        <legend className={labelClass}>Time slots</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          {TIME_SLOT_ORDER.map((slot) => (
            <label key={slot} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={timeSlots.includes(slot)}
                onChange={() => toggleSlot(slot)}
              />
              {TIME_SLOT_LABELS[slot]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Select all three for a full-day booking. At least one is needed to submit.
        </p>
        <FieldError field="timeSlots" />
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save request'}
      </button>
    </form>
  );
}
