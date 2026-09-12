import Link from 'next/link';
import { getVenueFormOptions } from '@/domain/venues/service';
import VenueForm from '@/components/venue/VenueForm';

/**
 * SCRUM-116 Add a venue to the catalogue, plus SCRUM-117 and SCRUM-118, which
 * are recorded on the same form.
 *
 * The dropdown data is fetched on the server so the form arrives ready to use.
 * Submitting goes through POST /api/venues from the browser.
 *
 * TODO(SCRUM-69): gate on canManageVenues(currentUserRoles). Only Venue Staff
 * may add a venue.
 */

export const dynamic = 'force-dynamic';

export default async function NewVenuePage() {
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
