import Link from 'next/link';
import { ClientOrganisationForm } from '@/components/client-organisation/ClientOrganisationForm';
import { getClientOrganisation } from '@/domain/client-organisation/service';

export const dynamic = 'force-dynamic';

/** SCRUM-203 — "update a client organisation record" (story description). */
export default async function EditClientOrganisationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organisation = await getClientOrganisation(id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      {/* SCRUM-251 AC6: back to the organisation, the page before this one. */}
      <Link href={`/organisations/${organisation.id}`} className="text-sm text-[var(--brand)] hover:underline">
        ← {organisation.name}
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Edit {organisation.name}</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
        The name must stay unique. Contact details are optional.
      </p>

      <ClientOrganisationForm
        organisationId={organisation.id}
        initial={{
          name: organisation.name,
          contactName: organisation.contactName ?? '',
          contactEmail: organisation.contactEmail ?? '',
          contactPhone: organisation.contactPhone ?? '',
        }}
      />
    </main>
  );
}
