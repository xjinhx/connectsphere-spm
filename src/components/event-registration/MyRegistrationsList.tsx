'use client';

import Link from 'next/link';
import { useState } from 'react';
import { REGISTRATION_STATUS_LABELS, type MyRegistration } from '@/domain/event-registration/schema';
import { formatDayMonthYear, toSingaporeISODate } from '@/domain/shared/dates';
import { WithdrawRegistrationButton } from './WithdrawRegistrationButton';

/**
 * SCRUM-184 AC2 — the attendee's registrations. A withdrawn one stays in the
 * list with the status Withdrawn and its reference; withdrawing here changes
 * the row in place rather than removing it. The Withdraw action is offered
 * only where `canWithdraw` says so (AC1).
 */
export function MyRegistrationsList({ registrations }: { registrations: MyRegistration[] }) {
  const [rows, setRows] = useState(registrations);

  if (rows.length === 0) {
    return <p className="mt-6 text-sm text-[var(--text-muted)]">You have not registered for any events.</p>;
  }

  return (
    <ul className="mt-6 space-y-3">
      {rows.map((row) => (
        <li
          key={row.registration.id}
          data-registration={row.registration.reference}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
        >
          <Link href={`/register-events/${row.registration.eventRequestId}`} className="font-semibold underline">
            {row.eventName}
          </Link>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {row.eventDate ? (
              <>
                <dt className="text-[var(--text-muted)]">Event date</dt>
                <dd>{formatDayMonthYear(row.eventDate)}</dd>
              </>
            ) : null}
            <dt className="text-[var(--text-muted)]">Reference</dt>
            <dd>{row.registration.reference}</dd>
            <dt className="text-[var(--text-muted)]">Status</dt>
            <dd>{REGISTRATION_STATUS_LABELS[row.registration.status]}</dd>
            <dt className="text-[var(--text-muted)]">Registered on</dt>
            <dd>{formatDayMonthYear(toSingaporeISODate(new Date(row.registration.registeredAt)))}</dd>
          </dl>
          {row.canWithdraw ? (
            <div className="mt-3">
              <WithdrawRegistrationButton
                eventRequestId={row.registration.eventRequestId}
                registrationId={row.registration.id}
                eventName={row.eventName}
                onWithdrawn={(registration) =>
                  setRows((current) =>
                    current.map((r) => (r.registration.id === registration.id ? { ...r, registration, canWithdraw: false } : r)),
                  )
                }
              />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
