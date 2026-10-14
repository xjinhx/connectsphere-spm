import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { EQUIPMENT_CATEGORY_LABELS } from '@/domain/equipment/schema';
import type { EquipmentRequestView } from '@/domain/equipment-request/schema';
import { getEquipmentRequest } from '@/domain/equipment-request/service';
import { isActionPermitted } from '@/domain/identity/permissions';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-160 Record the equipment an event needs.
 *
 * One page for the event's equipment request:
 * AC6 Technical Support Staff open it and see the notes with the equipment
 *     list, read-only (TC-160-16 to TC-160-18).
 * The event's assigned coordinator sees the same, and records the request
 * here while the event is Approved or in Planning (request.canEdit).
 *
 * Anyone else - a coordinator the event is not assigned to included - is
 * refused by getEquipmentRequest and sees why, with nothing about the request
 * shown (TC-160-10: no add control).
 *
 * A server component reading through the domain service, and force-dynamic,
 * so after a save the list is read back from the stored rows (TC-160-01).
 */

export const dynamic = 'force-dynamic';

export default async function EventEquipmentRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentActor();

  let request: EquipmentRequestView;
  try {
    request = await getEquipmentRequest(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl p-8">
          <h1 className="text-2xl font-semibold">Equipment request</h1>
          <p className="mt-4 text-[var(--text-muted)]">
            Only Technical Support Staff and the event&apos;s assigned coordinator can view this equipment request.
          </p>
        </main>
      );
    }
    throw error;
  }

  // Back to where the viewer came from: the coordinator recording it to the
  // event, Technical Support Staff to their landing page.
  const backLink =
    !request.canEdit && isActionPermitted(actor.roles, 'equipment_request_view')
      ? { href: '/equipment-queue', label: '← Equipment requests' }
      : { href: `/events/${id}/review`, label: '← Back to the event' };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href={backLink.href} className="text-sm text-[var(--brand)] hover:underline">
        {backLink.label}
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Equipment request: {request.eventName}</h1>
        <EventRequestStatusBadge status={request.eventStatus} />
      </div>
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{request.eventReference}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Event date: {request.proposedDate ? formatSingaporeDate(request.proposedDate) : 'Not yet provided'}
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Equipment</h2>
        {request.lines.length === 0 ? (
          <p className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">
            No equipment has been requested yet.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)]">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th scope="col" className="p-3 font-medium">
                    Item
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Category
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Quantity
                  </th>
                  <th scope="col" className="p-3 font-medium">
                    Reserved
                  </th>
                </tr>
              </thead>
              <tbody>
                {request.lines.map((line) => (
                  <tr key={line.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="p-3">{line.equipmentName}</td>
                    <td className="p-3">{EQUIPMENT_CATEGORY_LABELS[line.category]}</td>
                    <td className="p-3">{line.quantity}</td>
                    <td className="p-3">{line.reserved ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* AC6: the notes, shown with the equipment list. Kept as typed, line
          breaks included (AC5, TC-160-14). */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold">Technical requirements</h2>
        <p className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm whitespace-pre-wrap">
          {request.technicalRequirements ?? (
            <span className="text-[var(--text-muted)]">No technical requirements entered.</span>
          )}
        </p>
      </section>
    </main>
  );
}
