import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-270 — bug against SCRUM-181 AC1: the page of a Cancelled or Completed
 * event said nothing of it and offered the Register form. PO, 28/10/2026: the
 * page opens, shows the event as Cancelled and has no Register button. The
 * page is rendered for real, as an Attendee; only the session and the read
 * behind it are replaced. Test case IDs are from SCRUM-270-test-cases.xlsx.
 */

// next/link needs the App Router mounted; a plain anchor is enough here.
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
import { FINAL_EVENT_REFUSALS } from '@/domain/event-registration/policy';
import type { RegistrationPageView } from '@/domain/event-registration/schema';
import AttendeeEventRegistrationPage from '@/app/register-events/[id]/page';

const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ATTENDEE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Year-End Gala with its period open, places remaining and not yet registered. */
const GALA: RegistrationPageView = {
  eventRequestId: EVENT_ID,
  eventName: 'Year-End Gala',
  // SCRUM-180 AC3's details; the status mark does not depend on them.
  description: null,
  eventDate: '2026-11-28',
  times: null,
  venues: [],
  period: { startDate: '2026-10-26', endDate: '2026-11-03' },
  periodRefusal: null,
  full: false,
  finalStatus: null,
  registration: null,
};

const REGISTRATION = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  reference: 'REG-2026-0320',
  eventRequestId: EVENT_ID,
  fullName: 'Tan Mei Ling',
  email: 'attendee@example.com',
  contactNumber: '+65 9000 0000',
  status: 'registered' as const,
  registeredAt: '2026-10-29T02:00:00.000Z',
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

/**
 * The Register form is on the page: a form or a submit button. Not the "Full
 * name" label, which the registration confirmation shows too.
 */
function hasRegisterForm(html: string): boolean {
  return html.includes('<form') || /<button[^>]*type="submit"/.test(html);
}

describe('SCRUM-270: a Cancelled or Completed event is shown as such, with no Register form', () => {
  it('TC-270-01 a Cancelled event is marked Cancelled beside its name and shows why, with no form', async () => {
    const html = await renderEventPage({ ...GALA, finalStatus: 'cancelled' });

    expect(html).toMatch(/Year-End Gala<span[^>]*>Cancelled<\/span>/);
    // Red, as SCRUM-180's My registrations marks a cancelled event.
    expect(html).toMatch(/<span[^>]*class="[^"]*text-red-700[^"]*"[^>]*>Cancelled<\/span>/);
    expect(html).toContain(FINAL_EVENT_REFUSALS.cancelled);
    expect(hasRegisterForm(html)).toBe(false);
  });

  it('TC-270-02 a Completed event is marked Completed beside its name and shows why, with no form', async () => {
    const html = await renderEventPage({ ...GALA, eventName: 'Annual Dinner', finalStatus: 'completed' });

    expect(html).toMatch(/Annual Dinner<span[^>]*>Completed<\/span>/);
    // Grey, as organisers see Completed; not red, since nothing went wrong.
    expect(html).toMatch(/<span[^>]*class="[^"]*text-slate-700[^"]*"[^>]*>Completed<\/span>/);
    expect(html).not.toMatch(/<span[^>]*class="[^"]*red[^"]*"[^>]*>Completed<\/span>/);
    expect(html).toContain(FINAL_EVENT_REFUSALS.completed);
    expect(hasRegisterForm(html)).toBe(false);
  });

  it('TC-270-05 someone already registered sees the event marked Cancelled and their registration, with no form', async () => {
    const html = await renderEventPage({ ...GALA, finalStatus: 'cancelled', registration: REGISTRATION });

    expect(html).toMatch(/Year-End Gala<span[^>]*>Cancelled<\/span>/);
    expect(html).toContain(FINAL_EVENT_REFUSALS.cancelled);
    expect(html).toContain('REG-2026-0320');
    expect(html).toContain('Your registration for this event.');
    expect(html).not.toContain('You are registered for this event.');
    expect(hasRegisterForm(html)).toBe(false);
  });

  it('TC-270-07 an event going ahead is not marked and still offers the form', async () => {
    const html = await renderEventPage(GALA);

    expect(html).not.toContain('Cancelled');
    expect(html).not.toContain('Completed');
    expect(hasRegisterForm(html)).toBe(true);
  });
});
