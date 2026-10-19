import Link from 'next/link';

/**
 * SCRUM-164 — the two pages Technical Support Staff work from, as tabs at the
 * top of each: the equipment request queue (their landing page) and the
 * equipment catalogue (SCRUM-240). Either is one click from the other.
 */
const TABS = [
  { key: 'queue', href: '/equipment-queue', label: 'Equipment request queue' },
  { key: 'catalogue', href: '/equipment', label: 'Equipment catalogue' },
] as const;

export function TechnicalSupportNav({ current }: { current: (typeof TABS)[number]['key'] }) {
  return (
    <nav aria-label="Technical Support" className="mb-6 flex gap-1 border-b border-[var(--border)]">
      {TABS.map((tab) =>
        tab.key === current ? (
          <span
            key={tab.key}
            aria-current="page"
            className="-mb-px border-b-2 border-[var(--brand)] px-4 py-2 text-sm font-medium text-[var(--brand)]"
          >
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.key}
            href={tab.href}
            className="-mb-px border-b-2 border-transparent px-4 py-2 text-sm text-[var(--text-muted)] hover:border-[var(--border)] hover:text-[var(--text)]"
          >
            {tab.label}
          </Link>
        ),
      )}
    </nav>
  );
}
