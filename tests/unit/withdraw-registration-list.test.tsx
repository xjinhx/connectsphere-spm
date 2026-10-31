import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-184 AC2: a withdrawn registration is shown as Withdrawn rather than
 * removed. "My registrations" is SCRUM-180's section on Open events (CL-70),
 * rendered here for real with the session and the service replaced. That the
 * service really returns a withdrawn row is
 * tests/integration/withdraw-registration.test.ts.
 *
 * Test case IDs are from SCRUM-184-test-cases.xlsx (TC-184-nn).
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
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));

import { listMyRegistrations, listOpenEvents } from '@/domain/event-registration/service';
import { getCurrentActor } from '@/lib/auth/currentActor';
import type { MyRegistration } from '@/domain/event-registration/schema';
import OpenEventsPage from '@/app/register-events/page';

function registration(overrides: Partial<MyRegistration>): MyRegistration {
  return {
    eventRequestId: '11111111-1111-4111-8111-111111111111',
    eventName: 'Client Appreciation Night',
    eventDate: '2026-11-15',
    times: { start: '18:00', end: '22:00' },
    venues: [{ name: 'Marina Bay Ballroom', address: null }],
    registrationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    reference: 'REG-2026-0001',
    status: 'registered',
    eventCancelled: false,
    ...overrides,
  };
}

async function renderMyRegistrations(registrations: MyRegistration[]): Promise<string> {
  vi.mocked(listOpenEvents).mockResolvedValue([]);
  vi.mocked(listMyRegistrations).mockResolvedValue(registrations);
  const html = renderToStaticMarkup((await OpenEventsPage()) as ReactElement);
  return html.slice(html.indexOf('id="my-registrations"'));
}

/** Each listed registration as [event name, status label], in page order. */
function rows(html: string): [string, string][] {
  return [...html.matchAll(/<li[^>]*>[\s\S]*?<span class="font-medium">([^<]+)<\/span>[\s\S]*?<span class="rounded-full[^"]*">([^<]+)<\/span>\s*<\/li>/g)].map(
    (match) => [match[1] ?? '', match[2] ?? ''],
  );
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

describe('SCRUM-184 AC2: shown as Withdrawn rather than removed', () => {
  it('TC-184-05 the withdrawn registration stays listed as Withdrawn; the other is Registered', async () => {
    const html = await renderMyRegistrations([
      registration({ status: 'withdrawn' }),
      registration({
        eventRequestId: '22222222-2222-4222-8222-222222222222',
        eventName: 'Partner Networking Lunch',
        eventDate: '2026-11-20',
        registrationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        reference: 'REG-2026-0002',
      }),
    ]);

    expect(rows(html)).toEqual([
      ['Client Appreciation Night', 'Withdrawn'],
      ['Partner Networking Lunch', 'Registered'],
    ]);
  });

  it('TC-184-06 withdrawn then registered again for the same event: both listed, one Withdrawn, one Registered', async () => {
    const html = await renderMyRegistrations([
      registration({ registrationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', reference: 'REG-2026-0003' }),
      registration({ status: 'withdrawn' }),
    ]);

    expect(rows(html)).toEqual([
      ['Client Appreciation Night', 'Registered'],
      ['Client Appreciation Night', 'Withdrawn'],
    ]);
    expect(html).not.toContain('>Withdraw<');
  });
});
