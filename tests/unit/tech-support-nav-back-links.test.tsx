import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-254 AC3: the venue page and its calendar each open with a back link to
 * the page before it (venue page → /venues, calendar → the venue page). The
 * pages are rendered for real, as Technical Support Staff; only the session
 * and the reads behind them are replaced. Test case IDs match the SCRUM-254
 * tab of the Sprint 4 sheet.
 */

// next/link needs the App Router mounted; a plain anchor keeps the href, which is what AC3 is about.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/venues/service', () => ({
  getVenue: vi.fn(),
  listSetupTurnaroundAffectedBookings: vi.fn(),
}));
vi.mock('@/domain/availability/service', () => ({ listUpcomingUnavailablePeriods: vi.fn() }));
vi.mock('@/domain/venue-hold/service', () => ({ listActiveVenueHolds: vi.fn(), listHoldableEvents: vi.fn() }));
vi.mock('@/domain/venues/calendar', () => ({ getVenueCalendar: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getVenue } from '@/domain/venues/service';
import { listUpcomingUnavailablePeriods } from '@/domain/availability/service';
import { getVenueCalendar } from '@/domain/venues/calendar';
import { ValidationError } from '@/domain/shared/errors';
import VenueDetailPage from '@/app/venues/[id]/page';
import VenueCalendarPage from '@/app/venues/[id]/calendar/page';

const VENUE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Tech Support',
    roles: ['technical_support'],
    clientOrganisation: null,
  });
});

/** The href of the link whose text is `text`, or null. */
function hrefOf(html: string, text: string): string | null {
  const match = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>\\s*${text}\\s*</a>`).exec(html);
  return match?.[1] ?? null;
}

describe('SCRUM-254 AC3: back links from a venue and its calendar', () => {
  it('TC-254-12: the venue page links back to /venues', async () => {
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

    const page = (await VenueDetailPage({ params: Promise.resolve({ id: VENUE_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, 'Back to catalogue')).toBe('/venues');
  });

  it('TC-254-13 / TC-254-15: the calendar links back to its own venue', async () => {
    // A rejected date range still renders the page, which is all this test needs.
    vi.mocked(getVenueCalendar).mockRejectedValue(new ValidationError('Choose a valid range.'));

    const page = (await VenueCalendarPage({
      params: Promise.resolve({ id: VENUE_ID }),
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, 'Back to venue')).toBe(`/venues/${VENUE_ID}`);
  });
});
