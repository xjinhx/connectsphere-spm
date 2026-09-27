'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OPERATING_SLOT_LABELS, type OperatingSlot } from '@/domain/venues/schema';

/**
 * SCRUM-151 AC1: Venue Staff pick a date, tick the affected slots and record
 * why. Several slots can be ticked in one save. Only the slots this venue
 * operates are offered, because a slot it does not operate is never offered
 * for booking anyway (SCRUM-116 AC4).
 *
 * Same request/response shape as RejectRequestForm: on success the page is
 * refreshed so the list comes from the server; on refusal the server's
 * message (a blank reason, a slot already unavailable) is shown as-is.
 */
export function MarkSlotsUnavailableForm({
  venueId,
  operatingSlots,
}: {
  venueId: string;
  operatingSlots: OperatingSlot[];
}) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<OperatingSlot[]>([]);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSlot(slot: OperatingSlot) {
    setSlots((current) => (current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot]));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/venues/${venueId}/unavailable-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, slots, reason }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.message ?? 'The slots could not be marked unavailable.');
      }
      setDate('');
      setSlots([]);
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The slots could not be marked unavailable.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <h3 className="text-sm font-medium">Mark slots unavailable</h3>

      <label className="block text-sm" htmlFor="unavailable-date">
        Date
        <input
          id="unavailable-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        />
      </label>

      <fieldset className="text-sm">
        <legend className="mb-1">Slots</legend>
        <div className="flex flex-wrap gap-4">
          {operatingSlots.map((slot) => (
            <label key={slot} className="flex items-center gap-2">
              <input type="checkbox" checked={slots.includes(slot)} onChange={() => toggleSlot(slot)} />
              {OPERATING_SLOT_LABELS[slot]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block text-sm" htmlFor="unavailable-reason">
        Reason
        <textarea
          id="unavailable-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          placeholder="Why can these slots not be used?"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
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
