import Link from 'next/link';
import type { Role } from '@/domain/identity/roles';

/**
 * SCRUM-234 — one bar of links between the pages of an account that is both a
 * Safety Officer and an Event Coordinator.
 *
 * Such an account lands on the safety check list (AC1, Change Log CL-27), and
 * the app has no navigation menu yet (uilogicissue U4), so without this it
 * could only reach its coordinator pages by typing their addresses. The same
 * three links, in the same place, on all three pages, with the current one
 * marked. Shown only to an account holding both roles: a Safety Officer or a
 * Coordinator on their own sees exactly what they saw before.
 */

const PAGES = [
  { href: '/safety-checks', label: 'Safety checks' },
  { href: '/assigned-events', label: 'Assigned events' },
  { href: '/my-events', label: 'My events' },
] as const;

export type RolePage = (typeof PAGES)[number]['href'];

export function holdsSafetyOfficerAndCoordinator(roles: readonly Role[]): boolean {
  return roles.includes('safety_officer') && roles.includes('coordinator');
}

export function RolePagesBar({ roles, current }: { roles: readonly Role[]; current: RolePage }) {
  if (!holdsSafetyOfficerAndCoordinator(roles)) return null;

  return (
    <nav aria-label="Your pages" className="mb-6 flex flex-wrap gap-2">
      {PAGES.map((page) =>
        page.href === current ? (
          <span
            key={page.href}
            aria-current="page"
            className="inline-block rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white"
          >
            {page.label}
          </span>
        ) : (
          <Link
            key={page.href}
            href={page.href}
            className="inline-block rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50"
          >
            {page.label}
          </Link>
        ),
      )}
    </nav>
  );
}
