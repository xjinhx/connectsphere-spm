import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';

/**
 * SCRUM-252 AC3: opening a row on the unassigned queue opens the event's
 * assignment page with a back link to the queue and a link to the event.
 * SCRUM-252 AC4: that page, and the queue's own no-permission message, name
 * the role Event Coordinator Lead and never Event Operations Manager (the
 * stale wording found on /assignment-queue's own no-permission message).
 * The page is rendered for real, as the Event Coordinator Lead; only the
 * session and the reads behind it are replaced. Test case IDs match the
 * SCRUM-252 tab of the Sprint 4 sheet.
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
vi.mock('@/domain/assignment/service', () => ({
  getAssignmentRecord: vi.fn(),
  listAssignableCoordinators: vi.fn(),
  listUnassignedEvents: vi.fn(),
}));
// These forms call useRouter(), which needs the App Router mounted; AC3 is
// about the page's own links, not these forms, so they are stubbed out.
vi.mock('@/components/assignment/AssignCoordinatorForm', () => ({ AssignCoordinatorForm: () => null }));
vi.mock('@/components/assignment/ReassignCoordinatorForm', () => ({ ReassignCoordinatorForm: () => null }));

import { getCurrentActor } from '@/lib/auth/currentActor';
import { getAssignmentRecord, listAssignableCoordinators, listUnassignedEvents } from '@/domain/assignment/service';
import EventAssignmentPage from '@/app/assignment-queue/[id]/page';
import AssignmentQueuePage from '@/app/assignment-queue/page';

const EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const LEAD_ACTOR = {
  userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  fullName: 'The Lead',
  roles: ['operations_manager'],
  clientOrganisation: null,
};

const UNPRIVILEGED_ACTOR = {
  userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  fullName: 'An Attendee',
  roles: ['attendee'],
  clientOrganisation: null,
};

/** The href of the link whose text is `text`, or null. */
function hrefOf(html: string, text: string): string | null {
  const match = new RegExp(`<a[^>]*href="([^"]*)"[^>]*>\\s*${text}[^<]*</a>`).exec(html);
  return match?.[1] ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SCRUM-252 AC3: back link and event link on the assignment record page', () => {
  it('TC-252-05: links back to /assignment-queue and to the event itself', async () => {
    vi.mocked(getCurrentActor).mockResolvedValue(LEAD_ACTOR as unknown as Awaited<ReturnType<typeof getCurrentActor>>);
    vi.mocked(getAssignmentRecord).mockResolvedValue({
      event: {
        id: EVENT_ID,
        reference: 'REF-001',
        name: 'Annual Gala',
        proposedDate: null,
        submittedAt: null,
        clientOrganisation: null,
        startTime: null,
        endTime: null,
        expectedAttendance: null,
        status: 'submitted',
      },
      current: null,
      history: [],
    } as unknown as Awaited<ReturnType<typeof getAssignmentRecord>>);
    vi.mocked(listAssignableCoordinators).mockResolvedValue([]);

    const page = (await EventAssignmentPage({ params: Promise.resolve({ id: EVENT_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(hrefOf(html, '← Assignment queue')).toBe('/assignment-queue');
    expect(hrefOf(html, 'View event')).toBe(`/events/${EVENT_ID}/review`);
  });
});

describe('SCRUM-252 AC4: the role is named Event Coordinator Lead, never Event Operations Manager', () => {
  it('TC-252-06: the no-permission message on the assignment record page', async () => {
    vi.mocked(getCurrentActor).mockResolvedValue(
      UNPRIVILEGED_ACTOR as unknown as Awaited<ReturnType<typeof getCurrentActor>>,
    );

    const page = (await EventAssignmentPage({ params: Promise.resolve({ id: EVENT_ID }) })) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Event Coordinator Lead');
    expect(html).not.toContain('Event Operations Manager');
  });

  it('TC-252-06: the no-permission message on the unassigned queue', async () => {
    vi.mocked(getCurrentActor).mockResolvedValue(
      UNPRIVILEGED_ACTOR as unknown as Awaited<ReturnType<typeof getCurrentActor>>,
    );
    vi.mocked(listUnassignedEvents).mockResolvedValue([]);
    vi.mocked(listAssignableCoordinators).mockResolvedValue([]);

    const page = (await AssignmentQueuePage()) as ReactElement;
    const html = renderToStaticMarkup(page);

    expect(html).toContain('Event Coordinator Lead');
    expect(html).not.toContain('Event Operations Manager');
  });
});
