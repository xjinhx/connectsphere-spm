import Link from 'next/link';
import { getVenueFormOptions } from '@/domain/venues/service';
import { canManageVenues, canViewVenueCatalogue } from '@/domain/venues/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import VenueForm from '@/components/venue/VenueForm';
import NoVenueAccess from '@/components/venue/NoVenueAccess';

/**
 * SCRUM-116 Add a venue to the catalogue, plus SCRUM-117 and SCRUM-118, which
 * are recorded on the same form.
 *
 * The dropdown data is fetched on the server so the form arrives ready to use.
 * Submitting goes through POST /api/venues from the browser.
 *
 * Needs venue_administration. SCRUM-116 AC1 begins "Given I am Venue Staff",
 * so anyone else sees a no-access message instead of the form, and the POST
 * route refuses them with a 403 regardless.
 */

export const dynamic = 'force-dynamic';

export default async function NewVenuePage() {
  const actor = await getCurrentActor();
  // View first, so a role with no catalogue access is not pointed back at it.
  if (!canViewVenueCatalogue(actor.roles)) {
    return <NoVenueAccess need="view" />;
  }
  if (!canManageVenues(actor.roles)) {
    return <NoVenueAccess need="manage" />;
  }

  const options = await getVenueFormOptions();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/venues" className="text-sm text-[var(--brand)] underline">
        Back to catalogue
      </Link>
      <h1 className="mt-3 mb-6 text-2xl font-semibold">Add a venue</h1>
      <VenueForm options={options} />
    </main>
  );
}
