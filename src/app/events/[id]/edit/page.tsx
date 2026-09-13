import Link from 'next/link';
import { EventRequestForm } from '@/components/event-request/EventRequestForm';
import {
  getEventRequestDraftForEditing,
  getNewEventRequestContext,
} from '@/domain/event-request/service';
import { todayInSingapore } from '@/domain/shared/dates';
import type { TimeSlot } from '@/domain/event-request/schema';

// Depends on who is signed in and on stored data, so nothing to prerender.
export const dynamic = 'force-dynamic';

/**
 * SCRUM-85 — Resume editing a draft.
 *
 * AC3: every value previously entered is shown and editing continues. The form
 * is the same one used to create a request; only its starting values differ.
 *
 * Reaching this page for a request that is no longer a draft is refused in
 * getEventRequestDraftForEditing(), not here, so typing the URL cannot get
 * around SCRUM-82 AC4's read-only rule.
 */
export default async function EditEventRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const draft = await getEventRequestDraftForEditing(id);
  const { clientOrganisation } = await getNewEventRequestContext();

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href={`/events/${draft.id}`} className="text-sm text-[var(--brand)] hover:underline">
        ← Back to the request
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Continue editing</h1>
      <p className="mt-1 mb-6 font-mono text-sm text-[var(--text-muted)]">{draft.reference}</p>

      <EventRequestForm
        clientOrganisation={clientOrganisation}
        today={todayInSingapore()}
        requestId={draft.id}
        initial={{
          name: draft.name,
          purpose: draft.purpose ?? '',
          description: draft.description ?? '',
          // The date input wants YYYY-MM-DD, which is how the column stores it.
          proposedDate: draft.proposedDate ?? '',
          timeSlots: (draft.timeSlots ?? []) as TimeSlot[],
          expectedAttendance:
            draft.expectedAttendance === null ? '' : String(draft.expectedAttendance),
        }}
      />
    </main>
  );
}
