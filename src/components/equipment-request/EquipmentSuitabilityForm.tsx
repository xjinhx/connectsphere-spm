'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  SUITABILITY_LABELS,
  SUITABILITY_REASON_MAX_LENGTH,
  SUITABILITY_VERDICTS,
  type NotReadyReason,
  type Suitability,
} from '@/domain/equipment-request/schema';

/**
 * SCRUM-171 — Technical Support Staff review whether each requested item is
 * suitable for the event.
 *
 * AC1: mark each item suitable or not suitable and record why, then save. The
 * server checks the rules (a reason for not suitable) before saving, and the
 * items it refuses are shown with its message. AC4: "Complete review" saves the
 * marks and completes the review; the server decides whether the request is
 * ready to reserve and says why not, shown here until the page is refreshed.
 *
 * Rendered only for Technical Support Staff (view.canReview). After a save the
 * page is refreshed, so what is shown is read back from the stored request.
 */

type Line = {
  id: string;
  equipmentName: string;
  quantity: number;
  suitability: Suitability | null;
  suitabilityReason: string | null;
};
type Mark = { suitability: Suitability | ''; reason: string };
type ErrorPayload = { message?: string; details?: { lineIds?: string[] } } | null;

const BASE = (eventRequestId: string) => `/api/event-requests/${eventRequestId}/equipment-request`;

export default function EquipmentSuitabilityForm({ eventRequestId, lines }: { eventRequestId: string; lines: Line[] }) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, Mark>>(
    Object.fromEntries(
      lines.map((line) => [line.id, { suitability: line.suitability ?? '', reason: line.suitabilityReason ?? '' }]),
    ),
  );
  const [busy, setBusy] = useState<'save' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidLines, setInvalidLines] = useState<string[]>([]);
  const [result, setResult] = useState<{ saved: boolean; notReady: NotReadyReason[] | null } | null>(null);

  function update(lineId: string, change: Partial<Mark>) {
    setResult(null);
    // The server's message was about what was sent; once the item is changed it
    // no longer applies, so it is cleared until the next save checks again.
    setInvalidLines((current) => current.filter((id) => id !== lineId));
    if (invalidLines.length <= 1) setError(null);
    setMarks((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? { suitability: '', reason: '' }), ...change } }));
  }

  /** AC1: every item's mark, sent together. An item left as "Not marked" is sent as unmarked. */
  async function saveMarks(): Promise<boolean> {
    const response = await fetch(`${BASE(eventRequestId)}/suitability`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        verdicts: lines.map((line) => ({
          lineId: line.id,
          suitability: marks[line.id]?.suitability || null,
          reason: marks[line.id]?.reason ?? '',
        })),
      }),
    });
    if (response.ok) return true;
    const payload = (await response.json().catch(() => null)) as ErrorPayload;
    setInvalidLines(payload?.details?.lineIds ?? []);
    setError(payload?.message ?? 'The review could not be saved.');
    return false;
  }

  async function onSave() {
    setBusy('save');
    setError(null);
    setInvalidLines([]);
    setResult(null);
    try {
      if (await saveMarks()) {
        setResult({ saved: true, notReady: null });
        router.refresh();
      }
    } catch {
      setError('The review could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  /** AC4: save the marks, then complete the review; the server says whether it is ready to reserve. */
  async function onComplete() {
    setBusy('complete');
    setError(null);
    setInvalidLines([]);
    setResult(null);
    try {
      if (!(await saveMarks())) return;
      const response = await fetch(`${BASE(eventRequestId)}/review`, { method: 'POST' });
      const payload = (await response.json().catch(() => null)) as { notReady?: NotReadyReason[]; message?: string } | null;
      if (!response.ok) {
        setError(payload?.message ?? 'The review could not be completed.');
        return;
      }
      setResult({ saved: true, notReady: payload?.notReady ?? [] });
      router.refresh();
    } catch {
      setError('The review could not be completed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {lines.map((line) => {
        const mark = marks[line.id] ?? { suitability: '', reason: '' };
        const invalid = invalidLines.includes(line.id);
        return (
          <fieldset key={line.id} className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3">
            <legend className="px-1 text-sm font-medium">
              {line.equipmentName} × {line.quantity}
            </legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`suitability-${line.id}`}
                  checked={mark.suitability === ''}
                  onChange={() => update(line.id, { suitability: '' })}
                />
                Not marked
              </label>
              {SUITABILITY_VERDICTS.map((verdict) => (
                <label key={verdict} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`suitability-${line.id}`}
                    checked={mark.suitability === verdict}
                    onChange={() => update(line.id, { suitability: verdict })}
                  />
                  {SUITABILITY_LABELS[verdict]}
                </label>
              ))}
            </div>
            {mark.suitability !== '' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={`suitability-reason-${line.id}`} className="text-sm">
                  Why{mark.suitability === 'not_suitable' ? ' (required)' : ' (optional)'}
                </label>
                <textarea
                  id={`suitability-reason-${line.id}`}
                  value={mark.reason}
                  onChange={(event) => update(line.id, { reason: event.target.value })}
                  rows={2}
                  maxLength={SUITABILITY_REASON_MAX_LENGTH}
                  aria-invalid={invalid ? true : undefined}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                />
              </div>
            ) : null}
            {invalid && error ? (
              <p role="alert" className="text-sm text-[var(--danger)]">
                {error}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={busy !== null}
          className="w-fit rounded-md border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-60"
        >
          {busy === 'save' ? 'Saving...' : 'Save review'}
        </button>
        <button
          type="button"
          onClick={onComplete}
          disabled={busy !== null}
          className="w-fit rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {busy === 'complete' ? 'Completing...' : 'Complete review'}
        </button>
      </div>

      {error && invalidLines.length === 0 ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {result && !error ? (
        <div role="status" className="text-sm">
          {result.notReady === null ? (
            <p className="text-[var(--success)]">Saved.</p>
          ) : result.notReady.length === 0 ? (
            <p className="text-[var(--success)]">Review completed. The request is ready to reserve.</p>
          ) : (
            <>
              <p>Review completed. The request is not ready to reserve:</p>
              <ul className="mt-1 list-disc pl-5">
                {result.notReady.map((reason, index) => (
                  <li key={index}>{reason.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
