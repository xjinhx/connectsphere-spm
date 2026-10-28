import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prerenderToNodeStream } from 'react-dom/static';
import type { EventRequest } from '@/domain/event-request/service';

/**
 * SCRUM-250 AC3: a request page and its edit page each link back to Event
 * requests. The real pages are rendered; only the signed-in actor, the data
 * reads, the router and the Supabase browser client are replaced. Test case
 * IDs match the SCRUM-250 tab of the Sprint 4 test case sheet.
 */

const ORGANISER = 'organiser-1';

const getCurrentActor = vi.fn();
const getEventRequest = vi.fn();
const getEventRequestDraftForEditing = vi.fn();

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/events',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: vi.fn() }));
vi.mock('@/lib/auth/currentActor', () => ({ getCurrentActor: () => getCurrentActor() }));
vi.mock('@/domain/event-request/service', () => ({
  getEventRequest: (id: string) => getEventRequest(id),
  getEventRequestDraftForEditing: (id: string) => getEventRequestDraftForEditing(id),
  getNewEventRequestContext: async () => ({ organiserName: 'Olivia', clientOrganisation: { id: 'org-1', name: 'Harbour Events Pte Ltd' } }),
  getVenueRequirementOptions: async () => ({ accessibilityFeatures: [], locations: [] }),
}));
// Reads assignments from the database; not part of AC3.
vi.mock('@/components/assignment/CoordinatorPanel', () => ({ default: () => null }));
vi.mock('@/domain/review/service', () => ({
  getClarificationView: async (id: string) => ({ id, status: 'draft', clarificationNote: null, clarificationRequestedAt: null }),
  getApprovalView: async (id: string) => ({
    id,
    status: 'draft',
    decision: null,
    decidedAt: null,
    commitments: { venue: false, equipment: false, registration: false },
    commitmentStatement: null,
  }),
  getRejectionView: async (id: string) => ({ id, status: 'draft', rejectionReason: null, decidedAt: null }),
}));
// SCRUM-187's change-request list reads the database; not part of AC3.
vi.mock('@/domain/change-request/service', () => ({ listChangeRequests: async () => [] }));

import EventRequestPage from '@/app/events/[id]/page';
import EditEventRequestPage from '@/app/events/[id]/edit/page';

function eventRequest(overrides: Partial<EventRequest>): EventRequest {
  return {
    id: 'req-1',
    reference: 'EVT-2026-0001',
    organiserId: ORGANISER,
    clientOrganisationId: 'org-1',
    name: 'S250 Draft Breakfast',
    purpose: 'Client breakfast',
    description: null,
    proposedDate: '2026-12-10',
    startTime: null,
    endTime: null,
    expectedAttendance: null,
    status: 'draft',
    submittedAt: null,
    createdAt: '2026-10-27T01:00:00Z',
    updatedAt: '2026-10-27T01:00:00Z',
    roomLayout: null,
    accessibilityRequired: null,
    accessibilityFeatures: [],
    accessibilityNotes: null,
    preferredLocation: null,
    equipmentRequired: null,
    equipmentItems: [],
    technicalSupportNotes: null,
    registrationRequired: null,
    ...overrides,
  };
}

/** Every link on the page: [href, text]. */
function links(html: string): [string, string][] {
  return [...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href = '', text = '']) => [
    href,
    text.replace(/<[^>]+>/g, '').trim(),
  ]);
}

/** Renders the page to HTML, waiting for the async server components inside it. */
async function renderPage(page: (props: { params: Promise<{ id: string }> }) => Promise<React.ReactElement>, id: string) {
  const { prelude } = await prerenderToNodeStream(await page({ params: Promise.resolve({ id }) }));
  let html = '';
  for await (const chunk of prelude) html += chunk.toString();
  return html;
}

beforeEach(() => {
  getCurrentActor.mockResolvedValue({
    userId: ORGANISER,
    fullName: 'Olivia',
    roles: ['event_organiser'],
    clientOrganisation: { id: 'org-1', name: 'Harbour Events Pte Ltd' },
  });
});

describe('SCRUM-250 AC3: back links to Event requests', () => {
  it('TC-250-03: a draft opens with a back link, and its edit page has one too', async () => {
    const draft = eventRequest({ status: 'draft' });
    getEventRequest.mockResolvedValue(draft);
    getEventRequestDraftForEditing.mockResolvedValue(draft);

    const page = links(await renderPage(EventRequestPage, draft.id));
    expect(page).toContainEqual(['/events', '← Event requests']);
    // The way into the edit page is still offered on a draft.
    expect(page).toContainEqual([`/events/${draft.id}/edit`, 'Continue editing']);

    const edit = links(await renderPage(EditEventRequestPage, draft.id));
    expect(edit).toContainEqual(['/events', '← Event requests']);
  });

  it('TC-250-04: a submitted request shows the back link and no edit link', async () => {
    const submitted = eventRequest({ name: 'S250 Harbour Gala', status: 'submitted', submittedAt: '2026-10-27T02:00:00Z' });
    getEventRequest.mockResolvedValue(submitted);

    const page = links(await renderPage(EventRequestPage, submitted.id));
    expect(page).toContainEqual(['/events', '← Event requests']);
    expect(page.map(([href]) => href)).not.toContain(`/events/${submitted.id}/edit`);
  });
});
