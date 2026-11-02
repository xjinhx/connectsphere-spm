import { NO_PLACES_REMAINING } from '@/domain/event-registration/policy';

/**
 * SCRUM-182 AC1, AC2 — the event shown as full, in place of the registration
 * form: on the page when it loads full, and by the form when the API refuses
 * a registration as full (someone took the last place first).
 */
export function EventFullNotice() {
  return (
    <p role="status" className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
      <strong>Full.</strong> {NO_PLACES_REMAINING}
    </p>
  );
}
