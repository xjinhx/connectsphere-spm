import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EventVenueBookings } from '@/components/venue-booking/EventVenueBookings';
import type { EventVenueBooking } from '@/domain/venue-booking/schema';
import { formatDayMonthYearTime } from '@/domain/shared/dates';

/**
 * SCRUM-105 AC6 (TC-105-17): the event's Venue bookings list is its booking
 * history (CL-71). A booking released by a cancellation shows the cause
 * "Event cancelled", the cancelling coordinator and the time.
 */

function booking(overrides: Partial<EventVenueBooking>): EventVenueBooking {
  return {
    id: 'b1',
    venueName: 'Marina Bay Ballroom',
    date: '2026-11-12',
    startTime: '10:00',
    endTime: '12:00',
    status: 'confirmed',
    releaseReason: null,
    releasedByName: null,
    releasedAt: null,
    canRelease: false,
    replaced: false,
    reviewRequired: false,
    reviewRequiredAt: null,
    reviewRequiredCause: null,
    ...overrides,
  };
}

describe('SCRUM-105 AC6 TC-105-17: the release in the booking history', () => {
  it('shows the cause, the cancelling coordinator and the time (DD/MM/YYYY HH:mm, Singapore)', () => {
    const html = renderToStaticMarkup(
      <EventVenueBookings
        bookings={[
          booking({
            status: 'released',
            releaseReason: 'Event cancelled',
            releasedByName: 'Coordinator A',
            releasedAt: '2026-10-30T07:45:00Z',
          }),
        ]}
      />,
    );
    expect(html).toContain('Released');
    expect(html).toContain('Reason: Event cancelled');
    expect(html).toContain('Released by Coordinator A on 30/10/2026 15:45');
  });

  it('says nothing about a release while the booking is confirmed', () => {
    const html = renderToStaticMarkup(<EventVenueBookings bookings={[booking({})]} />);
    expect(html).not.toContain('Released by');
  });

  it('formats an instant as DD/MM/YYYY HH:mm in Singapore, across midnight UTC', () => {
    expect(formatDayMonthYearTime('2026-10-30T16:05:00Z')).toBe('31/10/2026 00:05');
  });
});
