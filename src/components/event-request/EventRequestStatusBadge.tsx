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
  // SCRUM-90 — same reasoning: the build enforces exhaustiveness, and colour
  // is a first guess (amber, distinct from submitted/approved) for whoever
  // owns this component to revise.
  clarification_requested: 'bg-amber-50 text-amber-700',
  // SCRUM-93 — same reasoning: red (--danger) so a rejected request cannot be
  // mistaken for approved.
  rejected: 'bg-red-50 text-[var(--danger)]',
  // SCRUM-103 — same reasoning again. Planning and Confirmed follow on from
  // approved (green); Completed and Cancelled are finished, so grey like draft.
  planning: 'bg-indigo-50 text-indigo-700',
  confirmed: 'bg-green-100 text-green-800',
  completed: 'bg-slate-100 text-slate-700',
  cancelled: 'bg-slate-100 text-[var(--text-muted)] line-through',
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