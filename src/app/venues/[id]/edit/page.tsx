import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getVenue, getVenueFormOptions } from '@/domain/venues/service';
import { NotFoundError } from '@/domain/shared/errors';
import VenueForm from '@/components/venue/VenueForm';
import type { VenueDetail } from '@/domain/venues/schema';

/**
 * SCRUM-120 Update venue information, plus SCRUM-117 AC3 and SCRUM-118, which
 * are edited on the same form.
 *
 * The form is pre-filled with what the venue currently holds and submits the
 * full picture, so unticking a facility is what removes it (SCRUM-117 AC3).
 *
 * SCRUM-120 AC2, AC3 and AC4 are not implemented here: they need confirmed
 * bookings (SCRUM-148) and notifications (EP-20), neither in Sprint 1. A
 * capacity reduction currently saves with no affected-booking step, because
 * there are no bookings to affect.
 *
 * TODO(SCRUM-69): gate on canManageVenues(currentUserRoles).
 */

export const dynamic = 'force-dynamic';

export default async function EditVenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let venue: VenueDetail;
  try {
    venue = await getVenue(id);
  } catch (error) {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  }

  const options = await getVenueFormOptions();

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href={`/venues/${venue.id}`} className="text-sm text-[var(--brand)] underline">
        Back to {venue.name}
      </Link>
      <h1 className="mt-3 mb-6 text-2xl font-semibold">Edit {venue.name}</h1>
      <VenueForm options={options} venue={venue} />
    </main>
  );
}
