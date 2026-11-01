import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * SCRUM-268 (bug on SCRUM-249): after signing out, the last account's header
 * stayed on the login page until a reload. The header now never shows on a
 * signed-out page, whatever the layout still holds. Test case IDs match the
 * SCRUM-268 tab of the test case sheet.
 */

let pathname = '/login';

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
import { isSignedOutPage, SIGNED_OUT_PATHS } from '@/domain/session/policy';

function renderCoordinatorHeader(at: string): string {
  pathname = at;
  return renderToStaticMarkup(
    <AppHeader
      homeHref="/assigned-events"
      navItems={ROLE_NAV.coordinator}
      account={{ primary: 'coordinator@example.com', secondary: null }}
      roles={['coordinator']}
      workingRole="coordinator"
    />,
  );
}

describe('SCRUM-268: no header on the login page after signing out', () => {
  it('TC-268-01/02: the header left in the layout renders nothing on /login', () => {
    expect(renderCoordinatorHeader('/login')).toBe('');
  });

  it("TC-268-01/02: no trace of the last account's name or nav on /login", () => {
    const html = renderCoordinatorHeader('/login');
    expect(html).not.toContain('coordinator@example.com');
    expect(html).not.toContain('Review queue');
    expect(html).not.toContain('Log out');
  });

  it('TC-268-04: signed-in pages still show the full header', () => {
    const html = renderCoordinatorHeader('/assigned-events');
    expect(html).toContain('<header');
    expect(html).toContain('Review queue');
    expect(html).toContain('Account menu for coordinator@example.com');
  });

  it('TC-268-04: a page whose path only starts with /login is not treated as signed out', () => {
    expect(isSignedOutPage('/login')).toBe(true);
    expect(isSignedOutPage('/login-help')).toBe(false);
    expect(isSignedOutPage('/assigned-events')).toBe(false);
    expect(isSignedOutPage('/')).toBe(false);
  });

  it('the middleware and the header share one list of signed-out pages', () => {
    expect(SIGNED_OUT_PATHS).toEqual(['/login']);
  });
});
