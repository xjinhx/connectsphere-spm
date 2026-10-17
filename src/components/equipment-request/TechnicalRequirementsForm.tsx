'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TECHNICAL_REQUIREMENTS_MAX_LENGTH } from '@/domain/equipment-request/schema';

/**
 * SCRUM-160 AC5: "when I enter free-text technical requirements and save, then
 * the notes are stored with the request."
 *
 * Sent exactly as typed - line breaks and all - and stored that way
 * (TC-160-14). Only Save stores them: text typed and left unsaved changes
 * nothing (TC-160-15). After a save the page is refreshed, so what is shown is
 * read back from the stored request (TC-160-13).
 *
 * Rendered only for the event's assigned coordinator while the event is open
 * to it (the page decides, with request.canEdit); everyone else sees the notes
 * read-only.
 */

export default function TechnicalRequirementsForm({
  eventRequestId,
  technicalRequirements,
}: {
  eventRequestId: string;
  technicalRequirements: string | null;
}) {
  const router = useRouter();
  const [text, setText] = useState(technicalRequirements ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/event-requests/${eventRequestId}/equipment-request`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ technicalRequirements: text }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? 'The technical requirements could not be saved.');
      }
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The technical requirements could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label htmlFor="technical-requirements" className="sr-only">
        Technical requirements
      </label>
      <textarea
        id="technical-requirements"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        rows={5}
        maxLength={TECHNICAL_REQUIREMENTS_MAX_LENGTH}
        placeholder="For example: HDMI to the stage lectern; 2 handheld mics with spare batteries"
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={submitting || text === (technicalRequirements ?? '')}
        className="w-fit rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Save technical requirements'}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p role="status" className="text-sm text-[var(--success)]">
          Saved.
        </p>
      ) : null}
    </form>
  );
}
