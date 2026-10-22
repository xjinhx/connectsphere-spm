import { REGISTRATION_STATUS_LABELS, type Registration } from '@/domain/event-registration/schema';
import { formatDayMonthYear, toSingaporeISODate } from '@/domain/shared/dates';

/**
 * SCRUM-181 — a registration as the attendee sees it: the confirmation after
 * registering (AC1), and the existing registration shown when they try again
 * (AC5). `heading` says which.
 */
export function RegistrationConfirmation({
  registration,
  heading,
  tone = 'success',
}: {
  registration: Registration;
  heading: string;
  tone?: 'success' | 'notice';
}) {
  return (
    <section
      role="status"
      className={`mt-6 rounded-lg border p-4 ${
        tone === 'success' ? 'border-[var(--success)]' : 'border-[var(--border)]'
      } bg-[var(--surface)]`}
    >
      <h2 className="text-sm font-semibold">{heading}</h2>
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-[var(--text-muted)]">Reference</dt>
        <dd>{registration.reference}</dd>
        <dt className="text-[var(--text-muted)]">Status</dt>
        <dd>{REGISTRATION_STATUS_LABELS[registration.status]}</dd>
        <dt className="text-[var(--text-muted)]">Registered on</dt>
        <dd>{formatDayMonthYear(toSingaporeISODate(new Date(registration.registeredAt)))}</dd>
        <dt className="text-[var(--text-muted)]">Full name</dt>
        <dd>{registration.fullName}</dd>
        <dt className="text-[var(--text-muted)]">Email address</dt>
        <dd>{registration.email}</dd>
        <dt className="text-[var(--text-muted)]">Contact number</dt>
        <dd>{registration.contactNumber}</dd>
      </dl>
    </section>
  );
}
