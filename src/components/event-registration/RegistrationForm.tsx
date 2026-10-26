'use client';

import { useState } from 'react';
import type { Registration, RegistrationInput } from '@/domain/event-registration/schema';
import { RegistrationConfirmation } from './RegistrationConfirmation';

/**
 * SCRUM-181 — the registration form on the Attendee's event page.
 *
 * AC1: full name, email address and contact number; on success the
 * confirmation replaces the form. A missing or invalid field is shown beside
 * it. AC2, AC3: a period that closed or has not opened since the page loaded
 * is refused by the API with the date, shown here. AC5: already registered
 * shows the existing registration instead.
 *
 * The API decides all of it; this only shows what it says.
 */

type Field = keyof RegistrationInput;

const FIELDS: { name: Field; label: string; type: string; autoComplete: string }[] = [
  { name: 'fullName', label: 'Full name', type: 'text', autoComplete: 'name' },
  { name: 'email', label: 'Email address', type: 'email', autoComplete: 'email' },
  { name: 'contactNumber', label: 'Contact number', type: 'tel', autoComplete: 'tel' },
];

type ApiError = {
  message?: string;
  details?: { fieldErrors?: Partial<Record<Field, string[]>>; registration?: Registration };
};

export function RegistrationForm({ eventRequestId, eventName }: { eventRequestId: string; eventName: string }) {
  const [values, setValues] = useState<RegistrationInput>({ fullName: '', email: '', contactNumber: '' });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string[]>>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [registered, setRegistered] = useState<Registration | null>(null);
  const [existing, setExisting] = useState<Registration | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    // One request at a time; the database also stops a double-click (TC-181-15).
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/events/${eventRequestId}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const payload = (await response.json().catch(() => null)) as (Registration & ApiError) | null;
      if (response.ok && payload) {
        setRegistered(payload);
        return;
      }
      if (response.status === 409 && payload?.details?.registration) {
        setExisting(payload.details.registration);
        return;
      }
      setFieldErrors(payload?.details?.fieldErrors ?? {});
      setError(payload?.message ?? 'Your registration could not be saved.');
    } catch {
      setError('Your registration could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  if (registered) {
    return (
      <RegistrationConfirmation
        registration={registered}
        eventName={eventName}
        heading="Registration confirmed. Your place is recorded."
      />
    );
  }
  if (existing) {
    return (
      <RegistrationConfirmation
        registration={existing}
        eventName={eventName}
        heading="You are already registered for this event. Your existing registration:"
        tone="notice"
      />
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-semibold">Register</h2>

      {FIELDS.map((field) => (
        <div key={field.name}>
          <label htmlFor={`registration-${field.name}`} className="block text-sm font-medium">
            {field.label}
          </label>
          <input
            id={`registration-${field.name}`}
            name={field.name}
            type={field.type}
            autoComplete={field.autoComplete}
            value={values[field.name]}
            onChange={(change) => setValues({ ...values, [field.name]: change.target.value })}
            aria-invalid={Boolean(fieldErrors[field.name])}
            aria-describedby={fieldErrors[field.name] ? `registration-${field.name}-error` : undefined}
            // A flagged field gets a red border as well as its message, the same as FormField.
            className={`mt-1 w-full rounded-md border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)] ${
              fieldErrors[field.name] ? 'border-[var(--danger)]' : 'border-[var(--border)]'
            }`}
          />
          {fieldErrors[field.name] ? (
            <p id={`registration-${field.name}-error`} className="mt-1 text-sm text-[var(--danger)]">
              {fieldErrors[field.name]?.join(' ')}
            </p>
          ) : null}
        </div>
      ))}

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {submitting ? 'Registering...' : 'Register'}
      </button>
    </form>
  );
}
