'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * SCRUM-203 AC1 — name plus optional contact details. AC2 — a duplicate name
 * comes back as an error, not a silent overwrite.
 *
 * The same form serves both jobs the story description names ("create and
 * update a client organisation record"): a blank create when `organisationId`
 * is unset, and an edit that PATCHes that organisation when it is set.
 *
 * SCRUM-204 AC1 — creating an organisation can also assign Event Organisers
 * to it in the same step, rather than requiring a second visit to the
 * organisation's page afterwards. Edit keeps using that page's "Linked Event
 * Organisers" panel instead - it already handles add/remove, so this field
 * only appears for a new organisation.
 *
 * There is still no account directory (see OrganiserMembershipPanel's note),
 * so organisers are entered by account id, not picked from a list.
 */

const labelClass = 'block text-sm font-medium text-[var(--text)]';
const fieldClass =
  'mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ' +
  'focus:border-[var(--brand)] focus:outline-none';

export interface ClientOrganisationFormInitialValues {
  name: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export function ClientOrganisationForm({
  organisationId,
  initial,
}: {
  /** Set when editing an existing organisation; unset for a new one. */
  organisationId?: string;
  initial?: ClientOrganisationFormInitialValues;
}) {
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? '');
  const [contactName, setContactName] = useState(initial?.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');

  const [organiserIds, setOrganiserIds] = useState<string[]>([]);
  const [organiserIdInput, setOrganiserIdInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [savedOrganisationId, setSavedOrganisationId] = useState<string | null>(null);

  function addOrganiserId() {
    const id = organiserIdInput.trim();
    if (id && !organiserIds.includes(id)) {
      setOrganiserIds([...organiserIds, id]);
    }
    setOrganiserIdInput('');
  }

  function removeOrganiserId(id: string) {
    setOrganiserIds(organiserIds.filter((existing) => existing !== id));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    setSavedOrganisationId(null);
    try {
      const response = await fetch(
        organisationId ? `/api/organisations/${organisationId}` : '/api/organisations',
        {
          method: organisationId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            contactName: contactName === '' ? undefined : contactName,
            contactEmail: contactEmail === '' ? undefined : contactEmail,
            contactPhone: contactPhone === '' ? undefined : contactPhone,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as {
        organisation?: { id: string };
        message?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      } | null;

      if (!response.ok || !payload?.organisation) {
        setFieldErrors(payload?.details?.fieldErrors ?? {});
        // AC2 — the API returns CONFLICT with this message for a duplicate name.
        throw new Error(payload?.message ?? 'The organisation could not be saved.');
      }

      const newOrganisationId = payload.organisation.id;

      // SCRUM-204 AC1 — assign each entered account after the organisation
      // itself exists to link against. A failure here doesn't undo the save
      // (the organisation is real either way) - it's surfaced so the
      // Coordinator can fix it from the organisation's page instead.
      const failures: string[] = [];
      for (const accountId of organiserIds) {
        const assignResponse = await fetch(`/api/accounts/${accountId}/organisation`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientOrganisationId: newOrganisationId }),
        });
        if (!assignResponse.ok) {
          const assignPayload = (await assignResponse.json().catch(() => null)) as { message?: string } | null;
          failures.push(`${accountId} (${assignPayload?.message ?? 'could not be linked'})`);
        }
      }

      if (failures.length > 0) {
        setError(`Organisation saved, but some Event Organisers could not be linked: ${failures.join(', ')}.`);
        setSavedOrganisationId(newOrganisationId);
        setSaving(false);
        return;
      }

      router.push(`/organisations/${newOrganisationId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The organisation could not be saved.');
      setSaving(false);
    }
  }

  function FieldError({ field }: { field: string }) {
    const messages = fieldErrors[field];
    if (!messages?.length) return null;
    return (
      <p className="mt-1 text-xs text-[var(--danger)]" role="alert">
        {messages[0]}
      </p>
    );
  }

  return (
    <form className="space-y-5" onSubmit={(event) => event.preventDefault()}>
      <div>
        <label className={labelClass} htmlFor="name">
          Organisation name
        </label>
        <input
          id="name"
          className={fieldClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <FieldError field="name" />
      </div>

      <div>
        <label className={labelClass} htmlFor="contactName">
          Contact name
        </label>
        <input
          id="contactName"
          className={fieldClass}
          value={contactName}
          onChange={(event) => setContactName(event.target.value)}
        />
        <FieldError field="contactName" />
      </div>

      <div>
        <label className={labelClass} htmlFor="contactEmail">
          Contact email
        </label>
        <input
          id="contactEmail"
          type="email"
          className={fieldClass}
          value={contactEmail}
          onChange={(event) => setContactEmail(event.target.value)}
        />
        <FieldError field="contactEmail" />
      </div>

      <div>
        <label className={labelClass} htmlFor="contactPhone">
          Contact phone
        </label>
        <input
          id="contactPhone"
          className={fieldClass}
          value={contactPhone}
          onChange={(event) => setContactPhone(event.target.value)}
        />
        <FieldError field="contactPhone" />
      </div>

      {!organisationId && (
        <div>
          <label className={labelClass} htmlFor="organiserIdInput">
            Add Event Organisers
          </label>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Enter each Event Organiser&apos;s account ID and add them - they&apos;ll be linked to this
            organisation as soon as it&apos;s saved. Optional; more can be linked later from the
            organisation&apos;s page.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              id="organiserIdInput"
              className={fieldClass}
              value={organiserIdInput}
              onChange={(event) => setOrganiserIdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addOrganiserId();
                }
              }}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
            <button
              type="button"
              onClick={addOrganiserId}
              className="shrink-0 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-slate-50"
            >
              Add
            </button>
          </div>

          {organiserIds.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {organiserIds.map((id) => (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 font-mono text-xs"
                >
                  {id}
                  <button
                    type="button"
                    onClick={() => removeOrganiserId(id)}
                    aria-label={`Remove ${id}`}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error ? (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          <p>{error}</p>
          {savedOrganisationId && (
            <Link href={`/organisations/${savedOrganisationId}`} className="mt-1 inline-block underline">
              View the organisation
            </Link>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {saving ? 'Saving...' : organisationId ? 'Save changes' : 'Save organisation'}
      </button>
    </form>
  );
}
