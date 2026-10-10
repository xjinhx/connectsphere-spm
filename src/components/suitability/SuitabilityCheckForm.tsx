'use client';

import { useState } from 'react';
import { VERDICT_LABELS, type SuitabilityResult } from '@/domain/suitability/schema';

export interface VenueOption {
  id: string;
  name: string;
}

/**
 * SCRUM-136: the coordinator picks a venue and checks it against the event.
 * The verdict is shown with each requirement checked: what the event needs,
 * what the venue offers, and what is wrong (AC1: the shortfall; AC3: the
 * unverified attendance).
 *
 * On refusal (not this coordinator's event, a venue that does not exist) the
 * server's message is shown as-is.
 */
export function SuitabilityCheckForm({ requestId, venues }: { requestId: string; venues: readonly VenueOption[] }) {
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuitabilityResult | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/suitability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId }),
      });
      const payload = (await response.json().catch(() => null)) as { result?: SuitabilityResult; message?: string } | null;
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.message ?? 'The suitability check could not be run.');
      }
      setResult(payload.result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The suitability check could not be run.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="block text-sm" htmlFor="suitability-venue">
          Venue
          <select
            id="suitability-venue"
            value={venueId}
            onChange={(event) => setVenueId(event.target.value)}
            className="mt-1 block rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            {venues.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={checking || venueId === ''}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {checking ? 'Checking...' : 'Check suitability'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {result ? (
        <div role="status" className="rounded-md border border-[var(--border)] p-3 text-sm">
          <p>
            <span className="font-medium">{result.venue.name}</span>: {VERDICT_LABELS[result.verdict]}
          </p>
          <ul className="mt-2 space-y-1">
            {result.requirements.map((requirement) => (
              <li key={requirement.requirement}>
                {requirement.label}: event {requirement.eventValue}; venue {requirement.venueValue}
                {requirement.detail ? ` - ${requirement.detail}` : ''}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
