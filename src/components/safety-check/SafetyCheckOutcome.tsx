import { SAFETY_CHECK_DECISION_LABELS, type SafetyCheckRecord } from '@/domain/safety-check/schema';
import { formatSingaporeDateTime } from '@/domain/shared/dates';

/**
 * SCRUM-234 — one safety check decision: what was decided, by whom and when
 * (AC3), with the reason for a rejection or a request for changes (AC4).
 * Shown to the assigned
 * coordinator on the event, and as the history on the Safety Officer's page.
 */
const TONE: Record<SafetyCheckRecord['decision'], string> = {
  approved: 'border-green-300 bg-green-50',
  changes_requested: 'border-[var(--warning)] bg-amber-50',
  rejected: 'border-[var(--danger)] bg-red-50',
};

const NOTE_LABEL: Record<SafetyCheckRecord['decision'], string | null> = {
  approved: null,
  changes_requested: 'Reason',
  rejected: 'Reason',
};

export function SafetyCheckOutcome({ check, heading = 'Operational safety check' }: { check: SafetyCheckRecord; heading?: string }) {
  const noteLabel = NOTE_LABEL[check.decision];
  return (
    <div className={`mt-4 rounded-md border px-3 py-2 text-sm ${TONE[check.decision]}`}>
      <p className="font-medium">
        {heading}: {SAFETY_CHECK_DECISION_LABELS[check.decision]}
      </p>
      {noteLabel && check.note ? (
        <p className="mt-1 whitespace-pre-wrap">
          <span className="font-medium">{noteLabel}:</span> {check.note}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        By {check.decidedByName} on {formatSingaporeDateTime(check.decidedAt)}
      </p>
    </div>
  );
}
