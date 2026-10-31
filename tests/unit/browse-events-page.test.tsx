import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative).
 * The Attendee's pages rendered for real, with the session and the service
 * replaced: what Open events shows (AC1), what the event page shows (AC3) and
 * what My registrations shows (AC4, AC6).
 * Which events the service returns is tests/unit/browse-events-service.test.ts;
 * that nothing internal is read is tests/integration/browse-events.test.ts.
 *
 * Test case IDs are from the ConnectSphere_TestCases_Sprint4 workbook,
 * SCRUM-180 tab (TC-180-nn).
 */

// next/link needs the App Router mounted; a plain anchor keeps the href.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/domain/event-registration/service', () => ({
  listOpenEvents: vi.fn(),
  listMyRegistrations: vi.fn(),
  getRegistrationPage: vi.fn(),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import { getRegistrationPage, listMyRegistrations, listOpenEvents } from '@/domain/event-registration/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import type { MyRegistration, OpenEvent, RegistrationPageView } from '@/domain/event-registration/schema';
import OpenEventsPage from '@/app/register-events/page';
import EventPage from '@/app/register-events/[id]/page';

const NIGHT: OpenEvent = {
  eventRequestId: '11111111-1111-4111-8111-111111111111',
  eventName: 'Client Appreciation Night',
  eventDate: '2026-11-15',
  times: { start: '18:00', end: '22:00' },
  venues: [{ name: 'Marina Bay Ballroom', address: '10 Bayfront Avenue, Singapore 018956' }],
};

const ATTENDEE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

async function renderOpenEvents(events: OpenEvent[], registrations: MyRegistration[] = []): Promise<string> {
  vi.mocked(listOpenEvents).mockResolvedValue(events);
  vi.mocked(listMyRegistrations).mockResolvedValue(registrations);
  return renderToStaticMarkup((await OpenEventsPage()) as ReactElement);
}

/** The My registrations section of the rendered page. */
function myRegistrations(html: string): string {
  return html.slice(html.indexOf('id="my-registrations"'));
}

function registrationFor(event: OpenEvent, overrides: Partial<MyRegistration> = {}): MyRegistration {
  return {
    ...event,
    registrationId: `reg-${event.eventRequestId}`,
    reference: 'REG-2026-0001',
    status: 'registered',
    eventCancelled: false,
    ...overrides,
  };
}

const BRIEFING: OpenEvent = {
  eventRequestId: '22222222-2222-4222-8222-222222222222',
  eventName: 'Product Launch Briefing',
  eventDate: '2026-11-15',
  times: { start: '10:00', end: '12:00' },
  venues: [{ name: 'Bugis Seminar Room', address: null }],
};

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
  full: false,
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
    userId: ATTENDEE_ID,
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

describe('My registrations (AC4)', () => {
  it('TC-180-09 lists each registration with the event name, date, times, venue and status Registered', async () => {
    const html = myRegistrations(await renderOpenEvents([], [registrationFor(NIGHT), registrationFor(BRIEFING)]));

    expect(listMyRegistrations).toHaveBeenCalledWith(ATTENDEE_ID);
    expect(html).toContain('Client Appreciation Night');
    expect(html).toContain('15/11/2026 · 18:00–22:00 · Marina Bay Ballroom');
    expect(html).toContain('Product Launch Briefing');
    expect(html).toContain('15/11/2026 · 10:00–12:00 · Bugis Seminar Room');
    expect(html.match(/>Registered</g)).toHaveLength(2);
  });

  it('TC-180-11 shows each registration\'s own status, Withdrawn included', async () => {
    const html = myRegistrations(
      await renderOpenEvents([], [registrationFor(NIGHT), registrationFor(BRIEFING, { status: 'withdrawn' })]),
    );

    expect(html).toContain('>Registered<');
    expect(html).toContain('>Withdrawn<');
  });

  it('TC-180-11 with no registrations, says so instead of an empty list', async () => {
    const html = myRegistrations(await renderOpenEvents([NIGHT], []));

    expect(html).toContain('You have not registered for any events yet.');
    expect(html).not.toContain('<ul');
  });
});

describe('a cancelled event in My registrations (AC6)', () => {
  it('TC-180-14 the registration stays listed, with the event marked Cancelled', async () => {
    const html = myRegistrations(await renderOpenEvents([], [registrationFor(NIGHT, { eventCancelled: true })]));

    expect(html).toContain('Client Appreciation Night');
    expect(html).toContain('>Cancelled<');
    expect(html).toContain('>Registered<');
  });

  it('TC-180-15 an event that is not cancelled is not marked Cancelled', async () => {
    const html = myRegistrations(await renderOpenEvents([], [registrationFor(NIGHT), registrationFor(BRIEFING)]));

    expect(html).not.toContain('Cancelled');
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
