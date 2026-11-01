'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LATEST_DATE, LATEST_DATE_TIME } from '@/domain/shared/dates';
import { endTimesAfter, keepEndAfterStart } from '@/domain/shared/times';
import type { HoldableEvent } from '@/domain/venue-hold/schema';

/** 00:00 to 24:00 in 15-minute steps: the times a hold may start or end on. */
const QUARTER_HOURS = Array.from({ length: 97 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});
const START_TIMES = QUARTER_HOURS.slice(0, -1);
const END_TIMES = QUARTER_HOURS.slice(1);

/**
 * SCRUM-227 AC1: Venue Staff choose the event, a date, a start and end time
 * and an expiry, and save; the hold is recorded as active. AC2: with no
 * expiry, or one in the past, the server refuses it and says a future expiry
 * is required, which is shown as-is.
 *
 * Times are chosen from 15-minute steps, so only times on the booking unit can
 * be picked (the server checks again, as for every time input). SCRUM-266: the
 * end list offers only times after the start, and the end is cleared when the
 * start moves to or past it. The expiry is
 * a Singapore date and time from a datetime-local input.
 *
 * Same request/response shape as MarkPeriodUnavailableForm: on success the
 * page is refreshed so the list of holds comes from the server.
 */
export function HoldVenueForm({ venueId, events }: { venueId: string; events: HoldableEvent[] }) {
  const router = useRouter();
  const [eventRequestId, setEventRequestId] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/venues/${venueId}/holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventRequestId, date, start, end, expiresAt }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? 'The hold could not be saved.');
      }
      setEventRequestId('');
      setDate('');
      setStart('');
      setEnd('');
      setExpiresAt('');
      setSaved('Hold saved. It is active until its expiry.');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The hold could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = 'mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="text-sm font-medium">Hold this venue</h3>

      <label className="block text-sm" htmlFor="hold-event">
        Event
        <select
          id="hold-event"
          value={eventRequestId}
          onChange={(event) => setEventRequestId(event.target.value)}
          className={fieldClass}
        >
          <option value="">Choose an approved event</option>
          {events.map((option) => (
            <option key={option.id} value={option.id}>
              {option.reference} {option.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm" htmlFor="hold-date">
        Date
        <input id="hold-date" type="date" max={LATEST_DATE} value={date} onChange={(event) => setDate(event.target.value)} className={fieldClass} />
      </label>

      <div className="flex flex-wrap gap-4">
        <label className="block text-sm" htmlFor="hold-start">
          Start time
          <select
            id="hold-start"
            value={start}
            onChange={(event) => {
              const next = event.target.value;
              setStart(next);
              setEnd((current) => keepEndAfterStart(next, current));
            }}
            className={fieldClass}
          >
            <option value="">--:--</option>
            {START_TIMES.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm" htmlFor="hold-end">
          End time
          <select id="hold-end" value={end} onChange={(event) => setEnd(event.target.value)} className={fieldClass}>
            <option value="">--:--</option>
            {endTimesAfter(start, END_TIMES).map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block text-sm" htmlFor="hold-expiry">
        Hold expires at (Singapore time)
        <input
          id="hold-expiry"
          type="datetime-local"
          max={LATEST_DATE_TIME}
          value={expiresAt}
          onChange={(event) => setExpiresAt(event.target.value)}
          className={fieldClass}
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
        {submitting ? 'Saving...' : 'Hold venue'}
      </button>
    </form>
  );
}
