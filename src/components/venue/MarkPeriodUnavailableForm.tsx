'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LATEST_DATE } from '@/domain/shared/dates';
import { END_TIME_OPTIONS, START_TIME_OPTIONS, endTimesAfter, keepEndAfterStart, toMinutes } from '@/domain/shared/times';

/**
 * SCRUM-151 AC2: after a save, say how many affected bookings' coordinators
 * were notified, so Venue Staff know nobody needs a separate call (customer
 * clarification #54 asked exactly that).
 */
function savedMessage(notifiedBookings: number): string {
  if (notifiedBookings === 0) return 'Saved.';
  if (notifiedBookings === 1) return 'Saved. The coordinator of 1 affected booking has been notified.';
  return `Saved. The coordinators of ${notifiedBookings} affected bookings have been notified.`;
}

/**
 * SCRUM-239 AC6 (SCRUM-151 AC1 in times): Venue Staff pick a date, a start
 * and end time in 15-minute steps, and record why. Replaces SCRUM-151's slot
 * checkboxes. Only times within the venue's opening hours are offered, since
 * the venue is never offered outside them anyway (the server checks too).
 * SCRUM-266: within those hours, the end list offers only times after the
 * start, and the end is cleared when the start moves to or past it.
 *
 * Same request/response shape as before: on success the page is refreshed so
 * the list comes from the server; on refusal the server's message (a blank
 * reason, a period already unavailable) is shown as-is.
 */
export function MarkPeriodUnavailableForm({
  venueId,
  opensAt,
  closesAt,
}: {
  venueId: string;
  opensAt: string;
  closesAt: string;
}) {
  const router = useRouter();
  const opens = toMinutes(opensAt);
  const closes = toMinutes(closesAt);
  const startOptions = START_TIME_OPTIONS.filter((time) => toMinutes(time) >= opens && toMinutes(time) < closes);
  const endOptions = END_TIME_OPTIONS.filter((time) => toMinutes(time) > opens && toMinutes(time) <= closes);

  const [date, setDate] = useState('');
  const [start, setStart] = useState(startOptions[0] ?? opensAt);
  const [end, setEnd] = useState(endOptions[endOptions.length - 1] ?? closesAt);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/venues/${venueId}/unavailable-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, start, end, reason }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; notifiedBookings?: number }
        | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? 'The period could not be marked unavailable.');
      }
      setDate('');
      setReason('');
      setSaved(savedMessage(payload?.notifiedBookings ?? 0));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The period could not be marked unavailable.');
    } finally {
      setSubmitting(false);
    }
  }

  const selectClass = 'mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="text-sm font-medium">Mark a period unavailable</h3>

      <label className="block text-sm" htmlFor="unavailable-date">
        Date
        <input
          id="unavailable-date"
          type="date"
          max={LATEST_DATE}
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={selectClass}
        />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="block text-sm" htmlFor="unavailable-start">
          Start time
          <select
            id="unavailable-start"
            value={start}
            onChange={(event) => {
              const next = event.target.value;
              setStart(next);
              setEnd((current) => keepEndAfterStart(next, current));
            }}
            className={selectClass}
          >
            {startOptions.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm" htmlFor="unavailable-end">
          End time
          <select id="unavailable-end" value={end} onChange={(event) => setEnd(event.target.value)} className={selectClass}>
            {/* Shown once a moved start has cleared the end. */}
            <option value="">--:--</option>
            {endTimesAfter(start, endOptions).map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm" htmlFor="unavailable-reason">
        Reason
        <textarea
          id="unavailable-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          placeholder="Why can the venue not be used then?"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-[var(--success)]">
          {saved}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Mark unavailable'}
      </button>
    </form>
  );
}
