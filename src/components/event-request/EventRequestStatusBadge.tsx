import {
  EVENT_REQUEST_STATUS_LABELS,
  type EventRequestStatus,
} from '@/domain/event-request/schema';

/**
 * SCRUM-82 — the status as the organiser sees it (AC3, AC4). One place for
 * the colour, and the label comes from the schema, so the list and the detail
 * page cannot disagree.
 */
const STATUS_CLASS: Record<EventRequestStatus, string> = {
  draft: 'bg-slate-100 text-[var(--text-muted)]',
  submitted: 'bg-blue-50 text-[var(--brand)]',
  // SCRUM-92 added the approved status, and this map must cover every status
  // or the build fails. Colour chosen to match the existing pair; SCRUM-82's
  // author owns this component and should change it if they disagree.
  approved: 'bg-green-50 text-green-700',
};

export function EventRequestStatusBadge({ status }: { status: EventRequestStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}
    >
      {EVENT_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}