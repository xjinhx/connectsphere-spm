import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { EventRequestStatusBadge } from '@/components/event-request/EventRequestStatusBadge';
import { EQUIPMENT_REQUEST_STATUS_LABELS } from '@/domain/equipment-request/schema';
import {
  ARRANGEMENT_PROGRESS_LABELS,
  NO_OUTSTANDING_ESSENTIAL_ARRANGEMENTS,
} from '@/domain/essential-arrangements/policy';
import { ARRANGEMENT_LABELS } from '@/domain/essential-arrangements/schema';
import type { EventRecordViewer } from '@/domain/event-record/policy';
import type { EventRecord } from '@/domain/event-record/schema';
import { getEventRecord } from '@/domain/event-record/service';
import {
  describeAccessibility,
  describeEquipment,
  describeEventTimes,
  describePreferredLocation,
  describeRegistration,
  describeRoomLayout,
  describeTechnicalSupport,
} from '@/domain/event-request/policy';
import { EVENT_REQUEST_STATUS_DEFINITIONS } from '@/domain/event-request/schema';
import { formatDayMonthYear, formatSingaporeDate } from '@/domain/shared/dates';
import { ForbiddenError, NotFoundError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * SCRUM-109 — View the full event record.
 *
 * AC1: one page with the event's details, status, assigned coordinator, venue
 * arrangement, equipment arrangement and registration setting. AC2: a section
 * the viewer may not see is not in the record (getEventRecord), so it is not
 * rendered, heading included. AC3: read-only for everyone, the Lead included:
 * this page has no form, button or link that changes anything.
 */

export const dynamic = 'force-dynamic';

const VENUE_BOOKING_STATUS_LABELS = { confirmed: 'Confirmed', released: 'Released' } as const;
const BOOKING_REQUEST_STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  partially_approved: 'Partially Approved',
  rejected: 'Rejected',
} as const;

const NOT_SET = 'Not set yet';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">{label}</dt>
      <dd className="mt-1 text-sm whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6" aria-label={title}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-1">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="py-3 text-sm text-[var(--text-muted)]">{children}</p>;
}

/** Back to the page the viewer reached the record from, by how they are related to the event. */
function backLinkFor(id: string, viewers: readonly EventRecordViewer[]): { href: string; label: string } {
  if (viewers.includes('coordinator') || viewers.includes('lead')) return { href: `/events/${id}/review`, label: '← Back to the event' };
  if (viewers.includes('organiser') || viewers.includes('colleague')) return { href: `/events/${id}`, label: '← Back to the event' };
  if (viewers.includes('technical_support')) return { href: `/events/${id}/equipment`, label: '← Equipment request' };
  return { href: '/booking-queue', label: '← Booking requests' };
}

export default async function EventRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await getCurrentActor();

  let record: EventRecord;
  try {
    record = await getEventRecord(id, actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    // AC1: "an event I am permitted to view". Nothing about the event is shown.
    if (error instanceof ForbiddenError) {
      return (
        <main className="mx-auto max-w-2xl px-4 py-8">
          <h1 className="text-xl font-semibold">Event record</h1>
          <p className="mt-4 text-[var(--text-muted)]">{error.message}</p>
        </main>
      );
    }
    throw error;
  }

  const { details } = record;
  const back = backLinkFor(record.id, record.viewers);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href={back.href} className="text-sm text-[var(--brand)] hover:underline">
        {back.label}
      </Link>

      <p className="mt-4 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">Full event record</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{record.name}</h1>
        {/* AC1, AC3: the status. */}
        <EventRequestStatusBadge status={record.status} />
      </div>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{EVENT_REQUEST_STATUS_DEFINITIONS[record.status]}</p>
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{record.reference}</p>

      {/* AC1: the details, as the organiser submitted them. */}
      <Section title="Event details">
        <dl>
          <Row label="Purpose" value={details.purpose ?? 'Not provided'} />
          <Row label="Description" value={details.description ?? 'Not provided'} />
          <Row label="Proposed date" value={details.proposedDate ? formatSingaporeDate(details.proposedDate) : 'Not provided'} />
          <Row label="Time" value={describeEventTimes(details.startTime, details.endTime)} />
          <Row
            label="Expected attendance"
            value={details.expectedAttendance !== null ? String(details.expectedAttendance) : 'Not provided'}
          />
          <Row label="Room layout" value={describeRoomLayout(details.roomLayout)} />
          <Row label="Preferred location" value={describePreferredLocation(details.preferredLocation)} />
          <Row label="Accessibility" value={describeAccessibility(details)} />
          <Row label="Equipment asked for" value={describeEquipment(details)} />
          <Row label="Technical support" value={describeTechnicalSupport(details.technicalSupportNotes)} />
        </dl>
      </Section>

      {/* AC1: the assigned coordinator. */}
      {record.coordinator !== undefined ? (
        <Section title="Assigned coordinator">
          {record.coordinator === null ? (
            <Empty>No coordinator has been assigned yet.</Empty>
          ) : (
            <dl>
              <Row label="Name" value={record.coordinator.name ?? 'Name not recorded'} />
              {record.coordinator.email ? <Row label="Email" value={record.coordinator.email} /> : null}
              {record.coordinator.contactNumber ? <Row label="Contact number" value={record.coordinator.contactNumber} /> : null}
            </dl>
          )}
        </Section>
      ) : null}

      {/* SCRUM-110's internal information: the coordinator and the Lead only. */}
      {record.internal ? (
        <Section title="Internal information">
          <dl>
            <Row label="Internal notes" value={record.internal.internalNotes ?? 'None recorded'} />
            <Row label="Client contact name" value={record.internal.clientContactName ?? 'None recorded'} />
            <Row label="Client contact email" value={record.internal.clientContactEmail ?? 'None recorded'} />
            <Row label="Client contact phone" value={record.internal.clientContactPhone ?? 'None recorded'} />
          </dl>
        </Section>
      ) : null}

      {/* AC1: the venue arrangement. */}
      {record.venue ? (
        <Section title="Venue arrangement">
          {record.venue.bookings.length === 0 && record.venue.requests.length === 0 ? (
            <Empty>No venue has been requested yet.</Empty>
          ) : (
            <>
              <h3 className="pt-3 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">Bookings</h3>
              {record.venue.bookings.length === 0 ? (
                <Empty>No venue booking yet.</Empty>
              ) : (
                <ul className="divide-y divide-[var(--border)] text-sm">
                  {record.venue.bookings.map((booking) => (
                    <li key={`${booking.venueName}-${booking.date}-${booking.startTime}`} className="flex justify-between gap-3 py-2">
                      <span>
                        {booking.venueName}, {formatDayMonthYear(booking.date)}, {booking.startTime} to {booking.endTime}
                      </span>
                      <span className="font-medium">{VENUE_BOOKING_STATUS_LABELS[booking.status]}</span>
                    </li>
                  ))}
                </ul>
              )}
              {record.venue.requests.length > 0 ? (
                <>
                  <h3 className="pt-3 text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
                    Booking requests
                  </h3>
                  <ul className="divide-y divide-[var(--border)] pb-2 text-sm">
                    {record.venue.requests.map((request) => (
                      <li key={request.id} className="flex justify-between gap-3 py-2">
                        <span>
                          {request.venueName},{' '}
                          {request.lines
                            .map((line) => `${formatDayMonthYear(line.date)} ${line.startTime} to ${line.endTime}`)
                            .join('; ')}
                        </span>
                        <span className="font-medium">{BOOKING_REQUEST_STATUS_LABELS[request.status]}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </Section>
      ) : null}

      {/* AC1: the equipment arrangement. */}
      {record.equipment ? (
        <Section title="Equipment arrangement">
          {record.equipment.lines.length === 0 ? (
            <Empty>No equipment has been requested yet.</Empty>
          ) : (
            <>
              {record.equipment.status ? (
                <p className="pt-3 text-sm">
                  Request status: <span className="font-medium">{EQUIPMENT_REQUEST_STATUS_LABELS[record.equipment.status]}</span>
                </p>
              ) : null}
              <ul className="divide-y divide-[var(--border)] pb-2 text-sm">
                {record.equipment.lines.map((line, index) => (
                  <li key={`${line.equipmentName}-${index}`} className="flex justify-between gap-3 py-2">
                    <span>
                      {line.equipmentName} × {line.quantity}
                    </span>
                    <span className="font-medium">{line.reserved ? 'Reserved' : 'Not yet reserved'}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>
      ) : null}

      {/* AC1: the registration setting. */}
      {record.registration ? (
        <Section title="Registration setting">
          <dl>
            <Row label="Attendee registration" value={describeRegistration(record.registration.required)} />
            <Row
              label="Start date"
              value={record.registration.startDate ? formatDayMonthYear(record.registration.startDate) : NOT_SET}
            />
            <Row label="End date" value={record.registration.endDate ? formatDayMonthYear(record.registration.endDate) : NOT_SET} />
            <Row
              label="Capacity"
              value={record.registration.capacity !== null ? String(record.registration.capacity) : NOT_SET}
            />
          </dl>
        </Section>
      ) : null}

      {/* AC3: which arrangements are essential, and whether each is complete. Nothing to change them. */}
      {record.essential ? (
        <Section title="Essential arrangements">
          {record.essential.length === 0 ? (
            <Empty>{NO_OUTSTANDING_ESSENTIAL_ARRANGEMENTS}</Empty>
          ) : (
            <ul className="divide-y divide-[var(--border)] text-sm">
              {record.essential.map((item) => (
                <li key={item.arrangement} className="py-2">
                  <div className="flex justify-between gap-3">
                    <span>{ARRANGEMENT_LABELS[item.arrangement]}</span>
                    <span className="font-medium">{ARRANGEMENT_PROGRESS_LABELS[item.progress]}</span>
                  </div>
                  {item.outstanding.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 text-[var(--text-muted)]">
                      {item.outstanding.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}
    </main>
  );
}
