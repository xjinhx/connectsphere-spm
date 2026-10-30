import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-253 AC3 and AC4: signed in as Venue Staff, the booking request page
 * links back to Booking requests, the venues catalogue links to Add venue,
 * and a venue page links to Edit and Calendar. The pages are rendered for
 * real, as Venue Staff; only the session and the reads behind them are
 * replaced. Test case IDs match the SCRUM-253 tab of the Sprint 4 sheet.
 */

// next/link needs the App Router mounted; a plain anchor keeps the href, which is what these ACs are about.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// Venue Staff can manage venues, so the venue page also renders client forms
// (MarkPeriodUnavailableForm, HoldVenueForm) that call useRouter(); this test
// is only about the Edit/Calendar links, so a stub is enough.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/venues/service', () => ({
  listVenues: vi.fn(),
  getVenue: vi.fn(),
  listSetupTurnaroundAffectedBookings: vi.fn(),
}));
vi.mock('@/domain/availability/service', () => ({ listUpcomingUnavailablePeriods: vi.fn() }));
vi.mock('@/domain/venue-hold/service', () => ({ listActiveVenueHolds: vi.fn(), listHoldableEvents: vi.fn() }));
vi.mock('@/domain/venue-booking/service', () => ({
  viewVenueBookingRequest: vi.fn(),
  getBookingRequestRequirements: vi.fn(),
  findPendingLineConflicts: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getVenue, listVenues, listSetupTurnaroundAffectedBookings } from '@/domain/venues/service';
import { listUpcomingUnavailablePeriods } from '@/domain/availability/service';
import { listActiveVenueHolds, listHoldableEvents } from '@/domain/venue-hold/service';
import { viewVenueBookingRequest, getBookingRequestRequirements, findPendingLineConflicts } from '@/domain/venue-booking/service';
import VenueCataloguePage from '@/app/venues/page';
import VenueDetailPage from '@/app/venues/[id]/page';
import VenueBookingRequestPage from '@/app/venue-booking-requests/[id]/page';

const VENUE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REQUEST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Venue Staff',
    roles: ['venue_staff'],
    clientOrganisation: null,
  });
});

/** The href of the link whose text is `text`, or null. */
function hrefOf(html: string, text: string): string | null {
  const match = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>\\s*${text}\\s*</a>`).exec(html);
  return match?.[1] ?? null;
}

describe('SCRUM-253 AC4: the Venues page links to Add venue', () => {
  it('TC-253-04: Add venue is offered to Venue Staff', async () => {
    vi.mocked(listVenues).mockResolvedValue([]);

    const page = (await VenueCataloguePage({ searchParams: Promise.resolve({}) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, 'Add venue')).toBe('/venues/new');
  });
});

describe('SCRUM-253 AC4: a venue page links to Edit and Calendar, each with a back link', () => {
  it('TC-253-04: the venue page offers Edit venue and View calendar', async () => {
    vi.mocked(getVenue).mockResolvedValue({
      id: VENUE_ID,
      name: 'Marina Bay Ballroom',
      isRetired: false,
      location: { id: 'l1', name: 'Marina Bay' },
      maxCapacity: 300,
      opensAt: '07:00',
      closesAt: '24:00',
      layouts: [],
      facilities: [],
      accessibilityFeatures: [],
      setupMinutes: 0,
      turnaroundMinutes: 0,
    } as unknown as Awaited<ReturnType<typeof getVenue>>);
    vi.mocked(listUpcomingUnavailablePeriods).mockResolvedValue([]);
    vi.mocked(listSetupTurnaroundAffectedBookings).mockResolvedValue([]);
    vi.mocked(listActiveVenueHolds).mockResolvedValue([]);
    vi.mocked(listHoldableEvents).mockResolvedValue([]);

    const page = (await VenueDetailPage({ params: Promise.resolve({ id: VENUE_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, 'Edit venue')).toBe(`/venues/${VENUE_ID}/edit`);
    expect(hrefOf(html, 'View calendar')).toBe(`/venues/${VENUE_ID}/calendar`);
    expect(hrefOf(html, 'Back to catalogue')).toBe('/venues');
    // The edit and calendar pages' own back links are covered by
    // tests/unit/tech-support-nav-back-links.test.tsx, which renders the same
    // pages; they do not vary by role.
  });
});

describe('SCRUM-253 AC3: the booking request page links back to Booking requests', () => {
  it('TC-253-03: back link is present and points at /booking-queue', async () => {
    // Decided (not 'pending'), so the page renders the read-only list rather
    // than VenueBookingDecisionForm (a client component that needs the App
    // Router mounted) — this test is only about the back link above it.
    vi.mocked(viewVenueBookingRequest).mockResolvedValue({
      id: REQUEST_ID,
      venueId: VENUE_ID,
      eventRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      coordinatorId: null,
      status: 'approved',
      lines: [],
    } as unknown as Awaited<ReturnType<typeof viewVenueBookingRequest>>);
    vi.mocked(getVenue).mockResolvedValue({
      id: VENUE_ID,
      name: 'Marina Bay Ballroom',
    } as unknown as Awaited<ReturnType<typeof getVenue>>);
    vi.mocked(getBookingRequestRequirements).mockResolvedValue({
      eventName: 'Launch Party',
      eventReference: 'EVT-1',
      requestedByName: 'Coordinator A',
      requestedAt: new Date().toISOString(),
      venueRequirements: {
        expectedAttendance: { value: null },
        roomLayout: { value: null },
        accessibility: { required: null, features: [], notes: null },
      },
    } as unknown as Awaited<ReturnType<typeof getBookingRequestRequirements>>);
    vi.mocked(findPendingLineConflicts).mockResolvedValue([]);
    vi.mocked(listVenues).mockResolvedValue([]);

    const page = (await VenueBookingRequestPage({ params: Promise.resolve({ id: REQUEST_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, 'Back to Booking requests')).toBe('/booking-queue');
  });
});
