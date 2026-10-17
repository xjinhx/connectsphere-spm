'use client';

import { useState } from 'react';
import {
  RequestVenueBookingForm,
  type EventPeriod,
  type EventRequirements,
  type VenueOption,
} from '@/components/event-request/RequestVenueBookingForm';

/**
 * SCRUM-229 AC1: on an affected booking's outstanding action, the coordinator
 * starts a replacement request (CONTEXT.md). It opens SCRUM-142's Request a
 * venue form with the booking's date and start and end time filled in, the
 * venue left to choose, and the booking it replaces sent with it. Once Venue
 * Staff approve it, the booking is released as replaced (AC4).
 */
export function ReplaceBookingAction({
  eventId,
  bookingId,
  period,
  venues,
  eventRequirements,
}: {
  eventId: string;
  bookingId: string;
  period: EventPeriod;
  venues: readonly VenueOption[];
  eventRequirements: EventRequirements;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--brand)] hover:bg-[var(--surface-hover)]"
      >
        Request a replacement venue
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 text-[var(--text)]">
      <h3 className="text-sm font-semibold">Request a replacement venue</h3>
      <div className="mt-3">
        <RequestVenueBookingForm
          requestId={eventId}
          venues={venues}
          eventPeriod={period}
          eventRequirements={eventRequirements}
          replacesBookingId={bookingId}
          idPrefix={`replace-${bookingId}`}
        />
      </div>
      <button type="button" onClick={() => setOpen(false)} className="mt-3 text-sm underline">
        Close
      </button>
    </div>
  );
}
