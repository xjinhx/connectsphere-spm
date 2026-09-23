import { ClientOrganisationForm } from '@/components/client-organisation/ClientOrganisationForm';

/** SCRUM-203 AC1, AC2 — create an organisation with a unique name. */
export default function NewClientOrganisationPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">New client organisation</h1>
      <p className="mt-1 mb-6 text-sm text-[var(--text-muted)]">
        The name must be unique. Contact details are optional.
      </p>

      <ClientOrganisationForm />
    </main>
  );
}
