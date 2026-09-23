'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LinkedOrganiser } from '@/domain/identity/schema';

/**
 * SCRUM-204 AC1 — link an Event Organiser account to this client
 * organisation, and see (and remove) who is already linked.
 *
 * There is no account directory yet (see identity/service.ts's
 * listOrganisersForOrganisation and the "no account listing" gap noted in
 * the ticket) - a Coordinator adds someone here by pasting their account id
 * rather than picking from a list of organisers. That's a real limitation,
 * not an oversight: it stands until an accounts directory exists.
 */
export function OrganiserMembershipPanel({
  organisationId,
  initialOrganisers,
}: {
  organisationId: string;
  initialOrganisers: LinkedOrganiser[];
}) {
  const router = useRouter();
  const [organisers, setOrganisers] = useState(initialOrganisers);
  const [accountId, setAccountId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/organisations/${organisationId}/organisers`);
    if (response.ok) {
      const payload = (await response.json()) as { organisers: LinkedOrganiser[] };
      setOrganisers(payload.organisers);
    }
    router.refresh();
  }

  async function assign(id: string, clientOrganisationId: string | null) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${id}/organisation`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientOrganisationId }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.message ?? 'The membership could not be saved.');
      }
      setAccountId('');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The membership could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium tracking-wide text-[var(--text-muted)] uppercase">
        Linked Event Organisers
      </h2>

      {organisers.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          No Event Organiser is linked to this organisation yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {organisers.map((organiser) => (
            <li key={organiser.accountId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{organiser.fullName}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{organiser.accountId}</p>
              </div>
              <button
                type="button"
                onClick={() => assign(organiser.accountId, null)}
                disabled={saving}
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-60"
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (accountId.trim()) assign(accountId.trim(), organisationId);
        }}
      >
        <div className="flex-1">
          <label className="block text-sm font-medium text-[var(--text)]" htmlFor="organiser-account-id">
            Event Organiser account ID
          </label>
          <input
            id="organiser-account-id"
            className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm focus:border-[var(--brand)] focus:outline-none"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            required
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {saving ? 'Linking...' : 'Link organiser'}
        </button>
      </form>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
