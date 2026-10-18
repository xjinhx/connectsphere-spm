'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ARRANGEMENTS,
  ARRANGEMENT_LABELS,
  ARRANGEMENT_NEED_LABELS,
  ArrangementNeedSchema,
  type ArrangementNeeds,
  type EssentialArrangementsView,
} from '@/domain/essential-arrangements/schema';
import { NO_OUTSTANDING_ESSENTIAL_ARRANGEMENTS } from '@/domain/essential-arrangements/policy';

/**
 * SCRUM-100 — which arrangements are essential for this event.
 *
 * AC2: with none marked essential, says there are no outstanding essential
 * arrangements. AC1: the assigned coordinator of an Approved or Planning event
 * marks each one essential or not required and saves. AC3: on a Confirmed
 * event the set is shown with no form, and the page says to return the event
 * to Planning first. The API refuses a change either way; hiding the form only
 * keeps the page from offering one it would refuse.
 */
export function EssentialArrangementsPanel({
  requestId,
  view,
}: {
  requestId: string;
  view: EssentialArrangementsView;
}) {
  const router = useRouter();
  const [needs, setNeeds] = useState<ArrangementNeeds>(view.needs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/essential-arrangements`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(needs),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? 'The essential arrangements could not be saved.');
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The essential arrangements could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">Essential arrangements</h2>

      {/* AC2, and the stored set read from the database on every load. */}
      <p className="mt-2 text-sm">
        {view.essential.length === 0
          ? NO_OUTSTANDING_ESSENTIAL_ARRANGEMENTS
          : `Essential: ${view.essential.map((arrangement) => ARRANGEMENT_LABELS[arrangement]).join(', ')}`}
      </p>

      {view.canChange ? (
        <form onSubmit={onSubmit} className="mt-3 space-y-3">
          {ARRANGEMENTS.map((arrangement) => (
            <fieldset key={arrangement} className="flex flex-wrap items-center gap-4">
              <legend className="w-40 text-sm">{ARRANGEMENT_LABELS[arrangement]}</legend>
              {ArrangementNeedSchema.options.map((need) => (
                <label key={need} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={`essential-${arrangement}`}
                    value={need}
                    checked={needs[arrangement] === need}
                    onChange={() => {
                      setNeeds({ ...needs, [arrangement]: need });
                      setSaved(false);
                    }}
                  />
                  {ARRANGEMENT_NEED_LABELS[need]}
                </label>
              ))}
            </fieldset>
          ))}

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}
          {saved ? <p className="text-sm text-[var(--text-muted)]">Saved.</p> : null}

          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save essential arrangements'}
          </button>
        </form>
      ) : view.changeRefusal ? (
        // AC3: say why there is no form, e.g. "Return it to Planning".
        <p className="mt-2 text-xs text-[var(--text-muted)]">{view.changeRefusal}</p>
      ) : null}
    </section>
  );
}
