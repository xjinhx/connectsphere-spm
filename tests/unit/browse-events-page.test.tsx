import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-180 Browse open events and see my registrations (Jira, authoritative).
 * The Attendee's pages rendered for real, with the session and the service
 * replaced: what Open events shows (AC1). Which events the service returns is
 * tests/unit/browse-events-service.test.ts.
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
vi.mock('@/domain/event-registration/service', () => ({ listOpenEvents: vi.fn() }));

import { listOpenEvents } from '@/domain/event-registration/service';
import type { OpenEvent } from '@/domain/event-registration/schema';
import OpenEventsPage from '@/app/register-events/page';

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

beforeEach(() => {
  vi.clearAllMocks();
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
