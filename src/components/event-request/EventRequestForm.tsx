'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TimeSlotEnum } from '@/domain/event-request/schema';

/**
 * SCRUM-76 AC1 — the blank request form, with the client organisation already
 * filled in and not editable.
 *
 * Two actions, because the story asks for two: saving keeps whatever has been
 * typed, submitting is the one that has to pass the rules. A refused submission
 * therefore leaves a saved draft behind rather than losing the work (AC3) -
 * which is why the draft's id is remembered here: pressing Submit twice edits
 * one request instead of creating two.
 */

const SLOTS = TimeSlotEnum.options;
const SLOT_LABELS: Record<string, string> = {
  AM: 'AM (7am-12pm)',
  PM: 'PM (1pm-6pm)',
  NIGHT: 'Night (7pm-12am)',
};

const labelClass = 'block text-sm font-medium text-[var(--text)]';
const fieldClass =
  'mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ' +
  'focus:border-[var(--brand)] focus:outline-none';

interface ApiErrorBody {
  message?: string;
}

async function call(path: string, method: string, body?: unknown): Promise<{ id: string }> {
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => null)) as
    | (ApiErrorBody & { id?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Something went wrong. Please try again.');
  }
  return { id: payload?.id ?? '' };
}

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
  const [timeSlots, setTimeSlots] = useState<string[]>([]);
  const [expectedAttendance, setExpectedAttendance] = useState('');

  const [draftId, setDraftId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'DRAFT' | 'SUBMIT' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function toggleSlot(slot: string) {
    setTimeSlots((current) =>
      current.includes(slot) ? current.filter((value) => value !== slot) : [...current, slot],
    );
  }

  async function save(): Promise<string> {
    const body = {
      name,
      purpose: purpose || undefined,
      description: description || undefined,
      proposedDate: proposedDate || undefined,
      timeSlots: timeSlots.length > 0 ? timeSlots : undefined,
      expectedAttendance: expectedAttendance === '' ? undefined : Number(expectedAttendance),
    };

    const saved = draftId
      ? await call(`/api/event-requests/${draftId}`, 'PATCH', body)
      : await call('/api/event-requests', 'POST', body);

    setDraftId(saved.id);
    return saved.id;
  }

  async function onSaveDraft() {
    setBusy('DRAFT');
    setError(null);
    setNotice(null);
    try {
      router.push(`/events/${await save()}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be saved.');
      setBusy(null);
    }
  }

  async function onSubmit() {
    setBusy('SUBMIT');
    setError(null);
    setNotice(null);
    try {
      const id = await save();
      await call(`/api/event-requests/${id}/submit`, 'POST');
      router.push(`/events/${id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The request could not be submitted.',
      );
      // The draft survives a refused submission - say so, or it looks lost.
      setNotice('Your work is saved as a draft. Fix the problem above and submit again.');
      setBusy(null);
    }
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
          Singapore time. Must be today or later to submit - a draft may hold any date.
        </p>
      </div>

      <fieldset>
        <legend className={labelClass}>Time slots</legend>
        <div className="mt-2 flex flex-wrap gap-4">
          {SLOTS.map((slot) => (
            <label key={slot} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={timeSlots.includes(slot)}
                onChange={() => toggleSlot(slot)}
              />
              {SLOT_LABELS[slot] ?? slot}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor="expectedAttendance">
          Expected attendance
        </label>
        <input
          id="expectedAttendance"
          type="number"
          min={1}
          step={1}
          className={fieldClass}
          value={expectedAttendance}
          onChange={(event) => setExpectedAttendance(event.target.value)}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-[var(--warning)]">{notice}</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy !== null}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {busy === 'SUBMIT' ? 'Submitting...' : 'Submit request'}
        </button>

        <button
          type="button"
          onClick={onSaveDraft}
          disabled={busy !== null}
          className="rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
        >
          {busy === 'DRAFT' ? 'Saving...' : 'Save as draft'}
        </button>
      </div>
    </form>
  );
}
