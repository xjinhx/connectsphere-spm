import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative).
 * The Attendee's pages rendered for real, with the session and the service
 * replaced: what Open events shows (AC1) and what the event page shows (AC3).
 * Which events the service returns is tests/unit/browse-events-service.test.ts;
 * that nothing internal is read is tests/integration/browse-events.test.ts.
 *
 * Test case IDs are from SCRUM-180-test-cases.xlsx (TC-180-nn).
 */

// next/link needs the App Router mounted; a plain anchor keeps the href.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/domain/event-registration/service', () => ({ listOpenEvents: vi.fn(), getRegistrationPage: vi.fn() }));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import { getRegistrationPage, listOpenEvents } from '@/domain/event-registration/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import type { OpenEvent, RegistrationPageView } from '@/domain/event-registration/schema';
import OpenEventsPage from '@/app/register-events/page';
import EventPage from '@/app/register-events/[id]/page';

const NIGHT: OpenEvent = {
  eventRequestId: '11111111-1111-4111-8111-111111111111',
  eventName: 'Client Appreciation Night',
  eventDate: '2026-11-15',
  times: { start: '18:00', end: '22:00' },
  venues: [{ name: 'Marina Bay Ballroom', address: '10 Bayfront Avenue, Singapore 018956' }],
};

async function renderOpenEvents(events: OpenEvent[]): Promise<string> {
  vi.mocked(listOpenEvents).mockResolvedValue(events);
  return renderToStaticMarkup((await OpenEventsPage()) as ReactElement);
}

/**
 * The event page as getRegistrationPage describes it. Registration not open
 * yet, so the page shows the start date rather than the form: AC3 is about the
 * event's details, which every state shows.
 */
const NIGHT_PAGE: RegistrationPageView = {
  eventRequestId: NIGHT.eventRequestId,
  eventName: NIGHT.eventName,
  description: 'An evening to thank our clients.',
  eventDate: '2026-11-15',
  times: { start: '18:00', end: '22:00' },
  venues: NIGHT.venues,
  period: { startDate: '2026-10-27', endDate: '2026-11-04' },
  periodRefusal: 'Registration opens on 27/10/2026.',
  registration: null,
};

async function renderEventPage(view: RegistrationPageView): Promise<string> {
  vi.mocked(getRegistrationPage).mockResolvedValue(view);
  const page = await EventPage({ params: Promise.resolve({ id: view.eventRequestId }) });
  return renderToStaticMarkup(page as ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Tan Mei Ling',
    roles: ['attendee'],
    clientOrganisation: null,
  });
});

describe('Open events (AC1)', () => {
  it('TC-180-01 shows the event name, date, start and end times and venue, linking to its page', async () => {
    const html = await renderOpenEvents([NIGHT]);

    expect(html).toContain('Client Appreciation Night');
    expect(html).toContain('15/11/2026');
    expect(html).toContain('18:00–22:00');
    expect(html).toContain('Marina Bay Ballroom');
    expect(html).toContain(`href="/register-events/${NIGHT.eventRequestId}"`);
  });

  it('TC-180-08 an event at two venues names both', async () => {
    const html = await renderOpenEvents([
      { ...NIGHT, venues: [{ name: 'Bugis Seminar Room', address: null }, NIGHT.venues[0]!] },
    ]);

    expect(html).toContain('Bugis Seminar Room, Marina Bay Ballroom');
  });

  it('says so when no event is open, rather than showing an empty list', async () => {
    const html = await renderOpenEvents([]);

    expect(html).toContain('No events are open for registration right now.');
    expect(html).not.toContain('<ul');
  });
});

describe('the event page opened from the list (AC3)', () => {
  it('TC-180-06 shows the name, description, date, times, venue name and address, and the registration period', async () => {
    const html = await renderEventPage(NIGHT_PAGE);

    expect(html).toContain('Client Appreciation Night');
    expect(html).toContain('An evening to thank our clients.');
    expect(html).toContain('15/11/2026');
    expect(html).toContain('18:00–22:00');
    expect(html).toContain('Marina Bay Ballroom');
    expect(html).toContain('10 Bayfront Avenue, Singapore 018956');
    expect(html).toContain('27/10/2026 to 04/11/2026');
  });

  it('TC-180-08 an event at two venues shows both, each with its address where one is recorded', async () => {
    const html = await renderEventPage({
      ...NIGHT_PAGE,
      venues: [
        { name: 'Bugis Seminar Room', address: '200 Victoria Street, Singapore 188021' },
        { name: 'Marina Bay Ballroom', address: '10 Bayfront Avenue, Singapore 018956' },
      ],
    });

    expect(html).toContain('Venues');
    expect(html).toContain('Bugis Seminar Room');
    expect(html).toContain('200 Victoria Street, Singapore 188021');
    expect(html).toContain('Marina Bay Ballroom');
    expect(html).toContain('10 Bayfront Avenue, Singapore 018956');
  });
});
