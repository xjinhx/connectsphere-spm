'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TIME_SLOT_ORDER, TIME_SLOT_LABELS, type TimeSlot } from '@/domain/event-request/schema';
import type { VenueBookingLineErrors, VenueBookingRequestErrorDetails } from '@/domain/venue-booking/schema';

export interface VenueOption {
  id: string;
  name: string;
}

interface Line {
  date: string;
  timeSlots: TimeSlot[];
}

function emptyLine(): Line {
  return { date: '', timeSlots: [] };
}

const NO_FIELD_ERRORS: VenueBookingRequestErrorDetails = { formErrors: [], fieldErrors: {}, lineErrors: [] };

function messagesFrom(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const messages = value.filter((message): message is string => typeof message === 'string');
  return messages.length > 0 ? messages : undefined;
}

/**
 * AC5: reads which fields a refusal named (venueBookingRequestErrorDetails)
 * out of the error body, without trusting its shape.
 */
function fieldErrorsFrom(details: unknown): VenueBookingRequestErrorDetails {
  if (typeof details !== 'object' || details === null) return NO_FIELD_ERRORS;
  const { formErrors, fieldErrors, lineErrors } = details as Record<string, unknown>;
  const fields = (typeof fieldErrors === 'object' && fieldErrors !== null ? fieldErrors : {}) as Record<string, unknown>;
  return {
    formErrors: messagesFrom(formErrors) ?? [],
    fieldErrors: { venueId: messagesFrom(fields.venueId), lines: messagesFrom(fields.lines) },
    lineErrors: Array.isArray(lineErrors)
      ? lineErrors.map((line): VenueBookingLineErrors => {
          const record = (typeof line === 'object' && line !== null ? line : {}) as Record<string, unknown>;
          return { date: messagesFrom(record.date), timeSlots: messagesFrom(record.timeSlots) };
        })
      : [],
  };
}

function FieldError({ id, messages }: { id: string; messages: string[] | undefined }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-[var(--danger)]">
      {messages.join(' ')}
    </p>
  );
}

/**
 * SCRUM-142 AC1, AC3 — the Coordinator's "request a venue" action.
 *
 * One venue for the whole request (AC1: "naming one venue"); one or more
 * date/slot lines under it (AC3: "the same venue on several dates... every
 * requested date and slot is carried on the one request"). Each line reuses
 * the same three time slots event_request's own form already uses
 * (TIME_SLOT_ORDER/LABELS), rather than inventing a second copy of them.
 *
 * Same request/response shape as RejectRequestForm/ApproveRequestButton: on
 * success the page is refreshed so the created request's status (Pending)
 * comes from the server, not assumed here; on refusal the message the API
 * sent (AC2's "the event must be approved..." or a validation error) is
 * shown as-is. AC5: a validation error also names each missing field, shown
 * beside that field on the line it belongs to.
 */
export function RequestVenueBookingForm({
  requestId,
  venues,
}: {
  requestId: string;
  venues: readonly VenueOption[];
}) {
  const router = useRouter();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<VenueBookingRequestErrorDetails>(NO_FIELD_ERRORS);
  const [submittedCount, setSubmittedCount] = useState<number | null>(null);

  function updateLine(index: number, next: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  function toggleSlot(index: number, slot: TimeSlot) {
    setLines((current) =>
      current.map((line, i) => {
        if (i !== index) return line;
        const has = line.timeSlots.includes(slot);
        return {
          ...line,
          timeSlots: has ? line.timeSlots.filter((s) => s !== slot) : [...line.timeSlots, slot],
        };
      }),
    );
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
    // The remaining lines' errors would now sit against the wrong line.
    setFieldErrors(NO_FIELD_ERRORS);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors(NO_FIELD_ERRORS);
    setSubmittedCount(null);
    try {
      const response = await fetch(`/api/event-requests/${requestId}/venue-booking-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId, lines }),
      });
      const payload = (await response.json().catch(() => null)) as {
        lines?: unknown[];
        message?: string;
        details?: unknown;
      } | null;

      if (!response.ok) {
        setFieldErrors(fieldErrorsFrom(payload?.details));
        throw new Error(payload?.message ?? 'The venue booking request could not be created.');
      }
      setSubmittedCount(payload?.lines?.length ?? lines.length);
      setLines([emptyLine()]);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'The venue booking request could not be created.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Errors about the request as a whole rather than one field, e.g. no dates at all.
  const generalErrors = [...fieldErrors.formErrors, ...(fieldErrors.fieldErrors.lines ?? [])];

  if (venues.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        No venues are in the catalogue yet, so a venue cannot be requested.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor="venue-booking-venue">
          Venue
        </label>
        <select
          id="venue-booking-venue"
          value={venueId}
          onChange={(event) => setVenueId(event.target.value)}
          aria-invalid={fieldErrors.fieldErrors.venueId ? true : undefined}
          aria-describedby={fieldErrors.fieldErrors.venueId ? 'venue-booking-venue-error' : undefined}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
        <FieldError id="venue-booking-venue-error" messages={fieldErrors.fieldErrors.venueId} />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Dates and slots needed</p>
        {lines.map((line, index) => {
          const lineErrors = fieldErrors.lineErrors[index] ?? {};
          return (
            <div key={index} className="rounded-md border border-[var(--border)] p-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-muted)]" htmlFor={`venue-booking-date-${index}`}>
                    Date
                  </label>
                  <input
                    id={`venue-booking-date-${index}`}
                    type="date"
                    value={line.date}
                    onChange={(event) => updateLine(index, { date: event.target.value })}
                    aria-invalid={lineErrors.date ? true : undefined}
                    aria-describedby={lineErrors.date ? `venue-booking-date-${index}-error` : undefined}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  />
                </div>
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removeLine(index)}
                    className="rounded-md border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                  >
                    Remove date
                  </button>
                ) : null}
              </div>
              <FieldError id={`venue-booking-date-${index}-error`} messages={lineErrors.date} />

              <div className="mt-2 flex flex-wrap gap-4">
                {TIME_SLOT_ORDER.map((slot) => (
                  <label key={slot} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={line.timeSlots.includes(slot)}
                      onChange={() => toggleSlot(index, slot)}
                    />
                    {TIME_SLOT_LABELS[slot]}
                  </label>
                ))}
              </div>
              <FieldError id={`venue-booking-slots-${index}-error`} messages={lineErrors.timeSlots} />
            </div>
          );
        })}

        <button
          type="button"
          onClick={addLine}
          className="text-sm text-[var(--brand)] hover:underline"
        >
          + Add another date for this venue
        </button>
      </div>

      {error ? (
        <div role="alert" className="text-sm text-[var(--danger)]">
          <p>{error}</p>
          {generalErrors.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {generalErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {submittedCount !== null ? (
        <p role="status" className="text-sm text-[var(--success,green)]">
          Venue booking request submitted — {submittedCount} date
          {submittedCount === 1 ? '' : 's'} pending Venue Staff review.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Submitting...' : 'Request venue'}
      </button>
    </form>
  );
}
