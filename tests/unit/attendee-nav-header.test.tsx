import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * SCRUM-255 AC2: the shared header, rendered for real for an Attendee-only
 * account, shows Open events and nothing else. Only the router and the
 * Supabase browser client are replaced. Test case IDs match the
 * ConnectSphere_TestCases_Sprint4 workbook, SCRUM-255 tab.
 */

let pathname = '/register-events';

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

function renderAttendeeHeader(at: string): string {
  pathname = at;
  return renderToStaticMarkup(
    <AppHeader
      homeHref="/register-events"
      navItems={ROLE_NAV.attendee}
      account={{ primary: 'attendee@example.com', secondary: null }}
      roles={['attendee']}
      workingRole="attendee"
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

describe('SCRUM-255 AC2: the header shows Open events on every page', () => {
  it('TC-255-04: one item, Open events, linking to /register-events and highlighted under it', () => {
    expect(navLinks(renderAttendeeHeader('/register-events'))).toEqual([['/register-events', 'Open events', true]]);
    expect(navLinks(renderAttendeeHeader('/register-events/abc'))).toEqual([['/register-events', 'Open events', true]]);
    expect(navLinks(renderAttendeeHeader('/notifications'))).toEqual([['/register-events', 'Open events', false]]);
  });

  it("TC-255-05: no other role's items and no Working as menu, even on another role's page", () => {
    const otherLabels = Object.entries(ROLE_NAV)
      .filter(([role]) => role !== 'attendee')
      .flatMap(([, items]) => items.map((item) => item.label));

    for (const page of ['/events', '/booking-queue', '/venues']) {
      const html = renderAttendeeHeader(page);
      expect(navLinks(html).map(([, label]) => label)).toEqual(['Open events']);
      for (const label of otherLabels) {
        expect(html).not.toContain(`>${label}<`);
      }
      expect(html).not.toContain('Working as');
    }
  });
});
