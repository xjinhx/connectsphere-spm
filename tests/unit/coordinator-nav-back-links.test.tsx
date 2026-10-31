import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-251 AC4, AC5 and AC6: a booking request links back to its event;
 * Venues offers Search and a venue links to its calendar; and a client
 * organisation's detail and edit pages each link back to the page before. The pages are rendered for real; only the session and the reads
 * behind them are replaced. Test case IDs match the SCRUM-251 tab of the
 * Sprint 4 sheet.
 */

// next/link needs the App Router mounted; a plain anchor keeps the href, which is what these ACs are about.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/venue-booking/service', () => ({
  viewVenueBookingRequest: vi.fn(),
  getBookingRequestRequirements: vi.fn(),
  findPendingLineConflicts: vi.fn(),
}));
vi.mock('@/domain/venues/service', () => ({
  getVenue: vi.fn(),
  listVenues: vi.fn(),
  listSetupTurnaroundAffectedBookings: vi.fn(),
}));
vi.mock('@/domain/availability/service', () => ({ listUpcomingUnavailablePeriods: vi.fn() }));
vi.mock('@/domain/venue-hold/service', () => ({ listActiveVenueHolds: vi.fn(), listHoldableEvents: vi.fn() }));
vi.mock('@/domain/client-organisation/service', () => ({ getClientOrganisation: vi.fn() }));
vi.mock('@/domain/identity/service', () => ({ listOrganisersForOrganisation: vi.fn() }));
// Not about these ACs, and each needs the router or data of its own.
vi.mock('@/components/client-organisation/ClientOrganisationForm', () => ({ ClientOrganisationForm: () => null }));
vi.mock('@/components/client-organisation/OrganiserMembershipPanel', () => ({ OrganiserMembershipPanel: () => null }));
vi.mock('@/components/venue-booking/VenueBookingDecisionForm', () => ({ VenueBookingDecisionForm: () => null }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getBookingRequestRequirements, viewVenueBookingRequest } from '@/domain/venue-booking/service';
import { getVenue, listVenues } from '@/domain/venues/service';
import { listUpcomingUnavailablePeriods } from '@/domain/availability/service';
import { getClientOrganisation } from '@/domain/client-organisation/service';
import { listOrganisersForOrganisation } from '@/domain/identity/service';
import VenueBookingRequestPage from '@/app/venue-booking-requests/[id]/page';
import VenueCataloguePage from '@/app/venues/page';
import VenueDetailPage from '@/app/venues/[id]/page';
import ClientOrganisationPage from '@/app/organisations/[id]/page';
import EditClientOrganisationPage from '@/app/organisations/[id]/edit/page';

const COORDINATOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VENUE_STAFF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORGANISATION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function signedInAs(userId: string, roles: string[]) {
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId,
    fullName: null,
    roles,
    clientOrganisation: null,
  } as unknown as Awaited<ReturnType<typeof getCurrentActor>>);
}

beforeEach(() => {
  vi.clearAllMocks();
  signedInAs(COORDINATOR_ID, ['coordinator']);
});

/** The href of the link whose text is `text`, or null. */
function hrefOf(html: string, text: string): string | null {
  const match = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>\\s*${text}\\s*</a>`).exec(html);
  return match?.[1] ?? null;
}

describe('SCRUM-251 AC4: a booking request links back to its event', () => {
  beforeEach(() => {
    vi.mocked(viewVenueBookingRequest).mockResolvedValue({
      id: REQUEST_ID,
      eventRequestId: EVENT_ID,
      venueId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      coordinatorId: COORDINATOR_ID,
      status: 'approved',
      lines: [],
    } as unknown as Awaited<ReturnType<typeof viewVenueBookingRequest>>);
    vi.mocked(getVenue).mockResolvedValue({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', name: 'Marina Bay Ballroom' } as Awaited<
      ReturnType<typeof getVenue>
    >);
    vi.mocked(getBookingRequestRequirements).mockResolvedValue({
      eventName: 'S251 Confirmed Dinner',
      eventReference: 'EVT-2026-0001',
      requestedByName: 'Coordinator A',
      requestedAt: '2026-10-25T02:00:00Z',
      expectedAttendance: 150,
      roomLayout: null,
      accessibilityRequired: false,
      accessibilityFeatures: [],
      accessibilityNotes: null,
      venueRequirements: {
        expectedAttendance: { value: 150, fromEvent: true },
        roomLayout: { value: null, fromEvent: true },
        accessibility: { required: false, features: [], notes: null, fromEvent: true },
      },
    });
  });

  async function render(): Promise<string> {
    const page = (await VenueBookingRequestPage({ params: Promise.resolve({ id: REQUEST_ID }) })) as ReactElement;
    return renderToStaticMarkup(page);
  }

  it("TC-251-08: the event's coordinator gets a back link to the event", async () => {
    expect(hrefOf(await render(), '← S251 Confirmed Dinner')).toBe(`/events/${EVENT_ID}/review`);
  });

  it('TC-251-09: Venue Staff, who come from their queue, do not', async () => {
    signedInAs(VENUE_STAFF_ID, ['venue_staff']);
    expect(hrefOf(await render(), '← S251 Confirmed Dinner')).toBeNull();
  });
});

describe('SCRUM-251 AC5: Venues offers Search, and a venue links to its calendar', () => {
  const VENUE_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  const venue = {
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
  };

  it('SCRUM-251 AC5 TC-251-10: Venues offers Search by date and time to the coordinator', async () => {
    vi.mocked(listVenues).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof listVenues>>);
    const page = (await VenueCataloguePage({ searchParams: Promise.resolve({}) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Venue catalogue');
    expect(hrefOf(html, 'Search by date and time')).toBe('/venues/search');
  });

  it("SCRUM-251 AC5 TC-251-10: a venue's page links the coordinator to its calendar", async () => {
    vi.mocked(getVenue).mockResolvedValue(venue as unknown as Awaited<ReturnType<typeof getVenue>>);
    vi.mocked(listUpcomingUnavailablePeriods).mockResolvedValue([]);
    const page = (await VenueDetailPage({ params: Promise.resolve({ id: VENUE_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, 'View calendar')).toBe(`/venues/${VENUE_ID}/calendar`);
  });
});

describe('SCRUM-251 AC6: client organisation pages link back to the page before', () => {
  beforeEach(() => {
    vi.mocked(getClientOrganisation).mockResolvedValue({
      id: ORGANISATION_ID,
      name: 'Harbour Events Pte Ltd',
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      events: [],
    } as unknown as Awaited<ReturnType<typeof getClientOrganisation>>);
    vi.mocked(listOrganisersForOrganisation).mockResolvedValue([]);
  });

  it('TC-251-11: the detail page links back to Client organisations and on to Edit', async () => {
    const page = (await ClientOrganisationPage({ params: Promise.resolve({ id: ORGANISATION_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, '← Client organisations')).toBe('/organisations');
    expect(html).toContain(`href="/organisations/${ORGANISATION_ID}/edit"`);
  });

  it('TC-251-11: the edit page links back to the organisation', async () => {
    const page = (await EditClientOrganisationPage({ params: Promise.resolve({ id: ORGANISATION_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, '← Harbour Events Pte Ltd')).toBe(`/organisations/${ORGANISATION_ID}`);
  });
});
