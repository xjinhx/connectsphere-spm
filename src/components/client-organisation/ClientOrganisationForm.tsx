'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * SCRUM-203 AC1 — name plus optional contact details. AC2 — a duplicate name
 * comes back as an error, not a silent overwrite.
 *
 * The same form serves both jobs the story description names ("create and
 * update a client organisation record"): a blank create when `organisationId`
 * is unset, and an edit that PATCHes that organisation when it is set.
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

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  async function onSave() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
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
      router.push(`/organisations/${payload.organisation.id}`);
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

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
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
