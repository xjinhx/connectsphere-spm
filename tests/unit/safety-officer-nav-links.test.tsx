import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-256 AC3: on Safety checks, each row opens that event's check page
 * (SCRUM-234), which has a back link to Safety checks. Both pages are rendered
 * for real as a Safety Officer; only the session and the reads behind them
 * are replaced. Test case IDs match the SCRUM-256 tab of the Sprint 4 sheet.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: vi.fn() }));
vi.mock('@/domain/safety-check/service', () => ({
  listEventsAwaitingSafetyCheck: vi.fn(),
  getSafetyCheckView: vi.fn(),
}));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getSafetyCheckView, listEventsAwaitingSafetyCheck } from '@/domain/safety-check/service';
import SafetyChecksPage from '@/app/safety-checks/page';
import SafetyCheckPage from '@/app/safety-checks/[id]/page';

const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    fullName: 'Safety Officer',
    roles: ['safety_officer'],
    clientOrganisation: null,
  });
});

/** The href of the link whose text contains `text`, or null. */
function hrefOf(html: string, text: string): string | null {
  for (const [, attributes = '', body = ''] of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)) {
    if (body.replace(/<[^>]+>/g, '').includes(text)) return /href="([^"]*)"/.exec(attributes)?.[1] ?? null;
  }
  return null;
}

describe('SCRUM-256 AC3: from Safety checks to a check page and back', () => {
  it("TC-256-11: a row on Safety checks opens that event's check page", async () => {
    vi.mocked(listEventsAwaitingSafetyCheck).mockResolvedValue([
      {
        id: EVENT_ID,
        reference: 'EVT-2026-0256',
        name: 'E256-A Gala',
        clientOrganisation: 'Acme',
        proposedDate: '2026-12-10',
        startTime: '09:00',
        endTime: '12:00',
        expectedAttendance: 120,
        venues: ['Marina Bay Ballroom'],
      },
    ]);

    const html = renderToStaticMarkup((await SafetyChecksPage()) as ReactElement);

    expect(hrefOf(html, 'E256-A Gala')).toBe(`/safety-checks/${EVENT_ID}`);
  });

  it('TC-256-11 / TC-256-12: the check page shows the event and links back to Safety checks', async () => {
    vi.mocked(getSafetyCheckView).mockResolvedValue({
      eventRequestId: EVENT_ID,
      reference: 'EVT-2026-0256',
      name: 'E256-A Gala',
      status: 'confirmed',
      clientOrganisation: 'Acme',
      proposedDate: '2026-12-10',
      startTime: '09:00',
      endTime: '12:00',
      expectedAttendance: '120',
      roomLayout: 'Theatre',
      accessibility: 'Not specified',
      venues: [],
      equipment: [],
      technicalRequirements: null,
      awaitingCheck: true,
      checks: [],
    });

    const html = renderToStaticMarkup(
      (await SafetyCheckPage({ params: Promise.resolve({ id: EVENT_ID }) })) as ReactElement,
    );

    expect(html).toContain('E256-A Gala');
    expect(html).toContain('EVT-2026-0256');
    expect(hrefOf(html, 'Safety checks')).toBe('/safety-checks');
  });
});
