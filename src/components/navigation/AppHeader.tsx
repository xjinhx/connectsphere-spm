'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { Role } from '@/domain/identity/roles';
import type { AccountDisplay, NavItem } from '@/domain/navigation/schema';
import { isNavItemCurrent } from '@/domain/navigation/policy';
import { NotificationBell } from '@/components/notification/NotificationBell';
import { AccountMenu } from './AccountMenu';
import { WorkingAsMenu } from './WorkingAsMenu';

interface AppHeaderProps {
  /** AC1 — where "ConnectSphere" leads: the working role's landing page. */
  homeHref: string;
  /** The nav items of the role being worked as (ROLE_NAV). */
  navItems: readonly NavItem[];
  account: AccountDisplay;
  roles: readonly Role[];
  workingRole: Role;
}

/**
 * SCRUM-249 — the header on every page for a signed-in user (rendered by the
 * root layout, which shows nothing here when nobody is signed in).
 *
 * AC1 "ConnectSphere" opens the landing page · AC2 bell and account menu ·
 * AC4 the current page's nav item is highlighted · AC5 "Working as" for an
 * account with several roles · AC6 below 768 px (Tailwind md) the nav folds
 * into a menu button.
 */
export function AppHeader({ homeHref, navItems, account, roles, workingRole }: AppHeaderProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the folded menu once a link in it has been followed.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const links = (layout: 'row' | 'column') =>
    navItems.map((item) => {
      const current = isNavItemCurrent(pathname, item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          aria-current={current ? 'page' : undefined}
          // Close the folded menu on any tap, including one on the page already open,
          // where the path does not change and the effect above would not run.
          onClick={layout === 'column' ? () => setMenuOpen(false) : undefined}
          className={[
            'rounded-md px-3 py-2 text-sm font-medium transition-colors',
            layout === 'column' ? 'block' : '',
            current
              ? 'bg-[var(--brand)] text-white'
              : 'text-[var(--text-muted)] hover:bg-slate-100 hover:text-[var(--text)]',
          ].join(' ')}
        >
          {item.label}
        </Link>
      );
    });

  return (
    <header className="border-b border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center gap-3 px-4 py-3 md:px-6">
        <button
          type="button"
          className="rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm font-medium md:hidden"
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="app-nav-menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span>
        </button>

        <Link href={homeHref} className="text-lg font-semibold text-[var(--brand)]">
          ConnectSphere
        </Link>

        <nav aria-label="Main" className="ml-4 hidden items-center gap-1 md:flex">
          {links('row')}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {roles.length > 1 && (
            <div className="hidden md:block">
              <WorkingAsMenu roles={roles} workingRole={workingRole} />
            </div>
          )}
          <NotificationBell />
          <AccountMenu account={account} workingRole={workingRole} />
        </div>
      </div>

      {menuOpen && (
        <nav id="app-nav-menu" aria-label="Main" className="space-y-1 border-t border-[var(--border)] px-4 py-3 md:hidden">
          {links('column')}
          {/* Below 768 px "Working as" moves into the folded menu, so the header row fits a phone. */}
          {roles.length > 1 && (
            <div className="border-t border-[var(--border)] pt-3">
              <WorkingAsMenu roles={roles} workingRole={workingRole} />
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
