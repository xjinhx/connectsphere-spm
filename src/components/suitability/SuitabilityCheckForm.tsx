'use client';

import { useState } from 'react';
import { formatSingaporeDateTime } from '@/domain/shared/dates';
import { unmetRequirements } from '@/domain/suitability/policy';
import { VERDICT_LABELS, type SuitabilityCheck } from '@/domain/suitability/schema';

export interface VenueOption {
  id: string;
  name: string;
}

/**
 * SCRUM-135 and SCRUM-136: the coordinator selects a venue and checks it
 * against the event.
 *
 * SCRUM-135 AC1: exactly one verdict.
 * SCRUM-135 AC2: unless suitable, each requirement not met is listed with the
 *                event's requirement and the venue's value side by side.
 * SCRUM-135 AC3: selecting a venue checked before shows its stored check and
 *                when it was run, without running it again (`checks`, from
 *                the server). Once the event's requirements have changed, it
 *                is shown as out of date instead, and the coordinator checks
 *                again.
 * SCRUM-136 AC1, AC3: the shortfall, or the unverified attendance, is the
 *                requirement's issue.
 *
 * On refusal (not this coordinator's event, a venue that does not exist) the
 * server's message is shown as-is.
 */
export function SuitabilityCheckForm({
  requestId,
  venues,
  checks,
}: {
  requestId: string;
  venues: readonly VenueOption[];
  checks: readonly SuitabilityCheck[];
}) {
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [byVenue, setByVenue] = useState<Record<string, SuitabilityCheck>>(() =>
    Object.fromEntries(checks.map((check) => [check.venue.id, check])),
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/suitability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId }),
      });
      const payload = (await response.json().catch(() => null)) as { result?: SuitabilityCheck; message?: string } | null;
      if (!response.ok || !payload?.result) {
        throw new Error(payload?.message ?? 'The suitability check could not be run.');
      }
      const result = payload.result;
      setByVenue((current) => ({ ...current, [result.venue.id]: result }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The suitability check could not be run.');
    } finally {
      setChecking(false);
    }
  }

  const shown = byVenue[venueId];

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <label className="block text-sm" htmlFor="suitability-venue">
          Venue
          <select
            id="suitability-venue"
            value={venueId}
            onChange={(event) => {
              setVenueId(event.target.value);
              setError(null);
            }}
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
          {checking ? 'Checking...' : shown ? 'Check again' : 'Check suitability'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {shown ? <CheckResult check={shown} /> : null}
    </div>
  );
}

function CheckResult({ check }: { check: SuitabilityCheck }) {
  if (check.outOfDate) {
    return (
      <div role="status" className="rounded-md border border-[var(--warning)] p-3 text-sm">
        <p className="font-medium">{check.venue.name}: out of date</p>
        <p className="mt-1 text-[var(--text-muted)]">
          The event&apos;s requirements have changed since this venue was checked on{' '}
          {formatSingaporeDateTime(check.checkedAt)}, so that result no longer applies. Check again for a current
          verdict.
        </p>
      </div>
    );
  }

  const unmet = unmetRequirements(check.requirements);
  return (
    <div role="status" className="rounded-md border border-[var(--border)] p-3 text-sm">
      <p>
        <span className="font-medium">{check.venue.name}</span>: {VERDICT_LABELS[check.verdict]}
      </p>
      <p className="text-xs text-[var(--text-muted)]">Checked {formatSingaporeDateTime(check.checkedAt)}</p>
      {unmet.length === 0 ? (
        <p className="mt-2">Every requirement checked is met.</p>
      ) : (
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">Requirements not met</caption>
          <thead className="text-xs text-[var(--text-muted)]">
            <tr>
              <th className="py-1 pr-3 font-medium">Requirement</th>
              <th className="py-1 pr-3 font-medium">Event needs</th>
              <th className="py-1 pr-3 font-medium">Venue has</th>
              <th className="py-1 font-medium">Issue</th>
            </tr>
          </thead>
          <tbody>
            {unmet.map((requirement) => (
              <tr key={requirement.requirement} className="border-t border-[var(--border)] align-top">
                <td className="py-1 pr-3">{requirement.label}</td>
                <td className="py-1 pr-3">{requirement.eventValue}</td>
                <td className="py-1 pr-3">{requirement.venueValue}</td>
                <td className="py-1">{requirement.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
