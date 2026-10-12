'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { END_TIME_OPTIONS, START_TIME_OPTIONS } from '@/domain/shared/times';
import type { VenueBookingLineErrors, VenueBookingRequestErrorDetails } from '@/domain/venue-booking/schema';

export interface VenueOption {
  id: string;
  name: string;
}

interface Line {
  date: string;
  start: string;
  end: string;
}

/** The event's own date and times (SCRUM-238), which a new request starts from. */
export interface EventPeriod {
  date: string | null;
  start: string | null;
  end: string | null;
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
          return { date: messagesFrom(record.date), start: messagesFrom(record.start), end: messagesFrom(record.end) };
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
 * SCRUM-142 AC1, AC3 — the Coordinator's "request a venue" action, in exact
 * times since SCRUM-239 AC3.
 *
 * One venue for the whole request (AC1: "naming one venue"); one or more
 * date-and-period lines under it (AC3: "the same venue on several dates...
 * every requested date is carried on the one request"). Each line has a start
 * and an end time chosen from the 15-minute options SCRUM-238's event form
 * uses (START_TIME_OPTIONS / END_TIME_OPTIONS), so a time off the unit cannot
 * be picked.
 *
 * The first line starts as the event's own date and times (SCRUM-238), and a
 * line added later starts with the event's times and no date; the coordinator
 * changes only what differs.
 *
 * Same request/response shape as RejectRequestForm/ApproveRequestButton: on
 * success the page is refreshed so the created request's status (Pending)
 * comes from the server, not assumed here; on refusal the message the API
 * sent is shown as-is (AC2's "the event must be approved...", a clash naming
 * the committed period, or a validation error). AC5: a validation error also
 * names each missing field, shown beside that field on the line it belongs to;
 * a clash or a period outside opening hours is shown beside the line's times.
 */
export function RequestVenueBookingForm({
  requestId,
  venues,
  eventPeriod,
}: {
  requestId: string;
  venues: readonly VenueOption[];
  eventPeriod: EventPeriod;
}) {
  const router = useRouter();
  const firstLine = (): Line => ({ date: eventPeriod.date ?? '', start: eventPeriod.start ?? '', end: eventPeriod.end ?? '' });
  const [venueId, setVenueId] = useState(venues[0]?.id ?? '');
  const [lines, setLines] = useState<Line[]>(() => [firstLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<VenueBookingRequestErrorDetails>(NO_FIELD_ERRORS);
  const [submittedCount, setSubmittedCount] = useState<number | null>(null);

  function updateLine(index: number, next: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line)));
  }

  function addLine() {
    setLines((current) => [...current, { date: '', start: eventPeriod.start ?? '', end: eventPeriod.end ?? '' }]);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
    // The remaining lines' errors would now sit against the wrong line.
    setFieldErrors(NO_FIELD_ERRORS);
    setError(null);
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
      setLines([firstLine()]);
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
        <p className="text-sm font-medium">Dates and times needed</p>
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

              <div className="mt-2 flex flex-wrap gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)]" htmlFor={`venue-booking-start-${index}`}>
                    Start time
                  </label>
                  <select
                    id={`venue-booking-start-${index}`}
                    value={line.start}
                    onChange={(event) => updateLine(index, { start: event.target.value })}
                    aria-invalid={lineErrors.start ? true : undefined}
                    aria-describedby={lineErrors.start ? `venue-booking-start-${index}-error` : undefined}
                    className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="">Choose</option>
                    {START_TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-muted)]" htmlFor={`venue-booking-end-${index}`}>
                    End time
                  </label>
                  <select
                    id={`venue-booking-end-${index}`}
                    value={line.end}
                    onChange={(event) => updateLine(index, { end: event.target.value })}
                    aria-invalid={lineErrors.end ? true : undefined}
                    aria-describedby={lineErrors.end ? `venue-booking-end-${index}-error` : undefined}
                    className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="">Choose</option>
                    {END_TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <FieldError id={`venue-booking-start-${index}-error`} messages={lineErrors.start} />
              <FieldError
                id={`venue-booking-end-${index}-error`}
                // The same message on both fields (e.g. "end must be after start") is shown once.
                messages={lineErrors.end?.filter((message) => !lineErrors.start?.includes(message))}
              />
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
