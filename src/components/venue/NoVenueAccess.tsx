import Link from 'next/link';

/**
 * Shown in place of a venue page when the signed-in user's role does not carry
 * the permission that page needs. Used by all four venue pages.
 *
 * "view": the catalogue itself (venue_catalogue_view, SCRUM-121)
 * "manage": the add and edit forms (venue_administration, SCRUM-116 and 120)
 *
 * The API routes enforce the same rules with a 403, so hiding a page is a
 * courtesy, not the security boundary.
 */
export default function NoVenueAccess({ need }: { need: 'view' | 'manage' }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-3 text-2xl font-semibold">No access</h1>
      <p role="alert" className="mb-4 text-[var(--text-muted)]">
        {need === 'view'
          ? 'Your role does not have access to the venue catalogue.'
          : 'Only Venue Staff can add or change venues.'}
      </p>
      <Link href={need === 'view' ? '/' : '/venues'} className="text-sm text-[var(--brand)] underline">
        {need === 'view' ? 'Back to home' : 'Back to catalogue'}
      </Link>
    </main>
  );
}
