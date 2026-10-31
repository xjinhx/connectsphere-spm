import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * SCRUM-250 AC2: the shared header, rendered for real for an Event
 * Organiser-only account, shows Event requests then New event request, with
 * one item highlighted per page. Only the router and the Supabase browser
 * client are replaced. Test case IDs match the SCRUM-250 tab of the Sprint 4
 * test case sheet.
 */

let pathname = '/events';

// next/link needs the App Router mounted; a plain anchor keeps the href, which is what AC2 is about.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/supabase/client', () => ({ createSupabaseBrowserClient: vi.fn() }));

import { AppHeader } from '@/components/navigation/AppHeader';
import { ROLE_NAV } from '@/domain/navigation/roleNav';

function renderOrganiserHeader(at: string): string {
  pathname = at;
  return renderToStaticMarkup(
    <AppHeader
      homeHref="/events"
      navItems={ROLE_NAV.event_organiser}
      account={{ primary: 'organiser@example.com', secondary: null }}
      roles={['event_organiser']}
      workingRole="event_organiser"
    />,
  );
}

/** The nav links in the header row: [href, label, highlighted]. */
function navLinks(html: string): [string, string, boolean][] {
  const nav = /<nav aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  return [...nav.matchAll(/<a([^>]*)>([^<]*)<\/a>/g)].map(([, attributes = '', label = '']) => [
    /href="([^"]*)"/.exec(attributes)?.[1] ?? '',
    label,
    attributes.includes('aria-current="page"'),
  ]);
}

describe('SCRUM-250 AC2: the header shows the organiser nav on every page', () => {
  it('TC-250-02: Event requests then New event request, each highlighted on its own page', () => {
    expect(navLinks(renderOrganiserHeader('/events'))).toEqual([
      ['/events', 'Event requests', true],
      ['/events/new', 'New event request', false],
    ]);
    expect(navLinks(renderOrganiserHeader('/events/new'))).toEqual([
      ['/events', 'Event requests', false],
      ['/events/new', 'New event request', true],
    ]);
  });

  it('TC-250-07: a request and its edit page highlight Event requests only', () => {
    for (const page of ['/events/abc', '/events/abc/edit']) {
      expect(navLinks(renderOrganiserHeader(page))).toEqual([
        ['/events', 'Event requests', true],
        ['/events/new', 'New event request', false],
      ]);
    }
    expect(navLinks(renderOrganiserHeader('/notifications')).every(([, , highlighted]) => !highlighted)).toBe(true);
  });

  it("TC-250-05: no other role's items and no Working as menu", () => {
    const organiserLabels = ROLE_NAV.event_organiser.map((item) => item.label);
    const otherLabels = Object.entries(ROLE_NAV)
      .filter(([role]) => role !== 'event_organiser')
      .flatMap(([, items]) => items.map((item) => item.label))
      .filter((label) => !organiserLabels.includes(label));

    for (const page of ['/events', '/assigned-events', '/venues']) {
      const html = renderOrganiserHeader(page);
      expect(navLinks(html).map(([, label]) => label)).toEqual(organiserLabels);
      for (const label of otherLabels) {
        expect(html).not.toContain(`>${label}<`);
      }
      expect(html).not.toContain('Working as');
    }
  });
});
