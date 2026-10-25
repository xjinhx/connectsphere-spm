import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-255 AC3: the Attendee's event page opens with a back link to Open
 * events. The page is rendered for real, as an Attendee; only the session and
 * the read behind it are replaced. Test case IDs match
 * SCRUM-255-test-cases.xlsx.
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
vi.mock('@/domain/event-registration/service', () => ({ getRegistrationPage: vi.fn() }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getRegistrationPage } from '@/domain/event-registration/service';
import type { RegistrationPageView } from '@/domain/event-registration/schema';
import AttendeeEventRegistrationPage from '@/app/register-events/[id]/page';

const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTENDEE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Client Appreciation Night, registration open and not yet registered. */
const OPEN: RegistrationPageView = {
  eventRequestId: EVENT_ID,
  eventName: 'Client Appreciation Night',
  eventDate: '2026-11-09',
  period: { startDate: '2026-10-21', endDate: '2026-10-29' },
  periodRefusal: null,
  registration: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentActor).mockResolvedValue({
    userId: ATTENDEE_ID,
    fullName: 'Tan Mei Ling',
    roles: ['attendee'],
    clientOrganisation: null,
  });
});

async function renderEventPage(view: RegistrationPageView): Promise<string> {
  vi.mocked(getRegistrationPage).mockResolvedValue(view);
  const page = (await AttendeeEventRegistrationPage({ params: Promise.resolve({ id: EVENT_ID }) })) as ReactElement;
  return renderToStaticMarkup(page);
}

/** The href of the link whose text is `text`, or null. */
function hrefOf(html: string, text: string): string | null {
  const match = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>\\s*${text}\\s*</a>`).exec(html);
  return match?.[1] ?? null;
}

describe('SCRUM-255 AC3: the event page links back to Open events', () => {
  it('TC-255-06: an event opened from Open events shows a back link to /register-events', async () => {
    const html = await renderEventPage(OPEN);

    expect(getRegistrationPage).toHaveBeenCalledWith(EVENT_ID, ATTENDEE_ID);
    expect(html).toContain('Client Appreciation Night');
    expect(hrefOf(html, 'Back to Open events')).toBe('/register-events');
  });

  it('TC-255-07: the back link is there in every registration state', async () => {
    const states: Record<string, RegistrationPageView> = {
      open: OPEN,
      'not yet open': { ...OPEN, periodRefusal: 'Registration opens on 26/10/2026.' },
      closed: { ...OPEN, periodRefusal: 'Registration closed on 22/10/2026.' },
      'already registered': {
        ...OPEN,
        registration: {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          reference: 'REG-2026-0027',
          eventRequestId: EVENT_ID,
          fullName: 'Tan Mei Ling',
          email: 'attendee@example.com',
          contactNumber: '+65 9123 4567',
          status: 'registered',
          registeredAt: '2026-10-24T02:00:00.000Z',
        },
      },
    };

    for (const [state, view] of Object.entries(states)) {
      const html = await renderEventPage(view);
      expect(hrefOf(html, 'Back to Open events'), state).toBe('/register-events');
    }
  });

  it('TC-255-08: the back link is a plain link to Open events, not history back', async () => {
    const html = await renderEventPage(OPEN);

    expect(hrefOf(html, 'Back to Open events')).toBe('/register-events');
    expect(html).not.toMatch(/<button[^>]*>\s*Back to Open events/);
    expect(html).not.toContain('history.back');
  });
});
