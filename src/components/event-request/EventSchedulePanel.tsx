'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { affectedArrangements, needsAcknowledgement } from '@/domain/significant-change/policy';
import type { EventScheduleView, ScheduleValues } from '@/domain/significant-change/schema';
import { START_TIME_OPTIONS, endTimesAfter, keepEndAfterStart } from '@/domain/shared/times';
import { ROOM_LAYOUTS, ROOM_LAYOUT_LABELS, type RoomLayout } from '@/domain/venues/schema';

/**
 * SCRUM-111 — the coordinator changes the event's date, times, expected
 * attendance or venue requirements.
 *
 * AC1, AC2: as the change is typed, the arrangements it would affect are
 * listed (worked out by the same policy the service uses), and Save stays
 * disabled until the coordinator ticks that they will be marked for review.
 * AC3: a change that affects nothing asks for nothing. The API repeats the
 * check, so a booking approved while the form is open is still caught.
 *
 * SCRUM-266: the end time offers only times after the start, and is cleared
 * when the start moves to or past it.
 *
 * Rendered only for the event's assigned coordinator while it can change
 * (view.canEdit); the values themselves are in the details list above.
 */

type Form = {
  proposedDate: string;
  startTime: string;
  endTime: string;
  expectedAttendance: string;
  roomLayout: string;
  accessibilityRequired: '' | 'yes' | 'no';
  accessibilityNotes: string;
};

type Field = keyof Form;

function toForm(values: ScheduleValues): Form {
  return {
    proposedDate: values.proposedDate ?? '',
    startTime: values.startTime ?? '',
    endTime: values.endTime ?? '',
    expectedAttendance: values.expectedAttendance === null ? '' : String(values.expectedAttendance),
    roomLayout: values.roomLayout ?? '',
    accessibilityRequired: values.accessibilityRequired === null ? '' : values.accessibilityRequired ? 'yes' : 'no',
    accessibilityNotes: values.accessibilityNotes ?? '',
  };
}

function toValues(form: Form): ScheduleValues {
  const attendance = Number(form.expectedAttendance);
  const required = form.accessibilityRequired === '' ? null : form.accessibilityRequired === 'yes';
  return {
    proposedDate: form.proposedDate || null,
    startTime: form.startTime || null,
    endTime: form.endTime || null,
    expectedAttendance: form.expectedAttendance.trim() === '' || Number.isNaN(attendance) ? null : attendance,
    roomLayout: (form.roomLayout || null) as RoomLayout | null,
    accessibilityRequired: required,
    accessibilityNotes: required === true ? form.accessibilityNotes.trim() || null : null,
  };
}

const INPUT = 'w-full rounded-md border px-3 py-2 text-sm';

export function EventSchedulePanel({ requestId, view }: { requestId: string; view: EventScheduleView }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => toForm(view.values));
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const affected = useMemo(
    () => affectedArrangements(view.values, toValues(form), { bookings: view.bookings, reservations: view.reservations }),
    [form, view],
  );
  const mustAcknowledge = needsAcknowledgement(affected);

  if (!view.canEdit) return null;

  function update(field: Field, value: string) {
    setForm(
      field === 'startTime'
        ? { ...form, startTime: value, endTime: keepEndAfterStart(value, form.endTime) }
        : { ...form, [field]: value },
    );
    // A different change affects different arrangements: tick again for it.
    setAcknowledged(false);
    setSavedMessage(null);
  }

  function startEditing() {
    setForm(toForm(view.values));
    setAcknowledged(false);
    setError(null);
    setFieldErrors({});
    setSavedMessage(null);
    setEditing(true);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const values = toValues(form);
      const response = await fetch(`/api/event-requests/${requestId}/schedule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposedDate: form.proposedDate,
          startTime: form.startTime,
          endTime: form.endTime,
          expectedAttendance: values.expectedAttendance ?? form.expectedAttendance,
          roomLayout: form.roomLayout,
          accessibilityRequired: values.accessibilityRequired,
          accessibilityNotes: values.accessibilityNotes ?? '',
          acknowledged,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
        details?: { fieldErrors?: Partial<Record<Field, string[]>> };
        flaggedBookings?: number;
        flaggedReservations?: number;
      } | null;
      if (response.status === 401) throw new Error('Your session has expired. Log in again, then make the change.');
      if (!response.ok) {
        const perField = Object.fromEntries(
          Object.entries(payload?.details?.fieldErrors ?? {}).flatMap(([field, messages]) =>
            messages?.[0] ? [[field, messages[0]]] : [],
          ),
        );
        setFieldErrors(perField);
        throw new Error(
          Object.keys(perField).length > 0
            ? 'Nothing was saved. Correct the highlighted field and save again.'
            : (payload?.message ?? 'The change could not be saved.'),
        );
      }
      const flagged = (payload?.flaggedBookings ?? 0) + (payload?.flaggedReservations ?? 0);
      setSavedMessage(
        flagged === 0
          ? 'Change saved. No arrangement was affected.'
          : `Change saved. ${flagged} arrangement${flagged === 1 ? ' is' : 's are'} now marked for review.`,
      );
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  function input(field: Field, label: string, control: React.ReactNode) {
    const invalid = Boolean(fieldErrors[field]);
    return (
      <div>
        <label htmlFor={`event-schedule-${field}`} className="block text-sm font-medium">
          {label}
        </label>
        {control}
        {invalid ? (
          <p id={`event-schedule-${field}-error`} className="mt-1 text-xs text-[var(--danger)]">
            {fieldErrors[field]}
          </p>
        ) : null}
      </div>
    );
  }

  function common(field: Field) {
    const invalid = Boolean(fieldErrors[field]);
    return {
      id: `event-schedule-${field}`,
      name: field,
      value: form[field],
      'aria-invalid': invalid,
      'aria-describedby': invalid ? `event-schedule-${field}-error` : undefined,
      className: `${INPUT} ${invalid ? 'border-[var(--danger)]' : 'border-[var(--border)]'}`,
    };
  }

  const affectedList = [...affected.bookings, ...affected.reservations];

  return (
    <section
      aria-labelledby="event-schedule-heading"
      className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="event-schedule-heading" className="text-sm font-semibold">
          Date, times, attendance and requirements
        </h2>
        {!editing ? (
          <button
            type="button"
            onClick={startEditing}
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Change date, times or requirements
          </button>
        ) : null}
      </div>
      {!editing ? (
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A change here can affect the venue bookings and equipment reservations already agreed.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-3 space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            {input('proposedDate', 'Date', <input type="date" {...common('proposedDate')} onChange={(e) => update('proposedDate', e.target.value)} />)}
            {input(
              'expectedAttendance',
              'Expected attendance',
              <input type="number" min={1} step={1} {...common('expectedAttendance')} onChange={(e) => update('expectedAttendance', e.target.value)} />,
            )}
            {input(
              'startTime',
              'Start time',
              <select {...common('startTime')} onChange={(e) => update('startTime', e.target.value)}>
                <option value="">Choose…</option>
                {START_TIME_OPTIONS.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>,
            )}
            {input(
              'endTime',
              'End time',
              <select {...common('endTime')} onChange={(e) => update('endTime', e.target.value)}>
                <option value="">Choose…</option>
                {endTimesAfter(form.startTime).map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>,
            )}
            {input(
              'roomLayout',
              'Room layout',
              <select {...common('roomLayout')} onChange={(e) => update('roomLayout', e.target.value)}>
                <option value="">No preference</option>
                {ROOM_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
                    {ROOM_LAYOUT_LABELS[layout]}
                  </option>
                ))}
              </select>,
            )}
            {input(
              'accessibilityRequired',
              'Accessibility requirements',
              <select {...common('accessibilityRequired')} onChange={(e) => update('accessibilityRequired', e.target.value)}>
                <option value="">Not yet answered</option>
                <option value="no">None required</option>
                <option value="yes">Required</option>
              </select>,
            )}
          </div>
          {form.accessibilityRequired === 'yes'
            ? input(
                'accessibilityNotes',
                'Accessibility notes',
                <textarea rows={2} {...common('accessibilityNotes')} onChange={(e) => update('accessibilityNotes', e.target.value)} />,
              )
            : null}

          {mustAcknowledge ? (
            <div className="rounded-md border border-[var(--warning)] bg-amber-50 px-3 py-2 text-sm">
              <p className="font-medium text-[var(--warning)]">This change affects arrangements already agreed</p>
              <ul className="mt-1 list-disc pl-5">
                {affectedList.map((arrangement) => (
                  <li key={arrangement.id}>
                    {arrangement.kind === 'venue_booking' ? 'Venue booking: ' : 'Equipment reservation: '}
                    {arrangement.label}
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5"
                />
                <span>I understand these arrangements will be marked for review.</span>
              </label>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving || (mustAcknowledge && !acknowledged)}
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
      )}
      {savedMessage && !editing ? <p className="mt-2 text-sm text-[var(--text-muted)]">{savedMessage}</p> : null}
    </section>
  );
}
