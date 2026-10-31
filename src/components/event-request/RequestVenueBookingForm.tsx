'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { START_TIME_OPTIONS, endTimesAfter, keepEndAfterStart } from '@/domain/shared/times';
import { ROOM_LAYOUTS, ROOM_LAYOUT_LABELS } from '@/domain/venues/schema';
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

/**
 * SCRUM-230 AC2: the event's own venue requirements, as the event page shows
 * them, so each empty field can say what it falls back to.
 */
export interface EventRequirements {
  expectedAttendance: number | null;
  roomLayout: string;
  accessibility: string;
}

/** SCRUM-230 AC1: the request's own venue requirements, as typed. Empty is "use the event's". */
interface OwnRequirements {
  expectedAttendance: string;
  roomLayout: string;
  accessibility: '' | 'yes' | 'no';
  accessibilityNotes: string;
}

const NO_OWN_REQUIREMENTS: OwnRequirements = { expectedAttendance: '', roomLayout: '', accessibility: '', accessibilityNotes: '' };

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
    fieldErrors: {
      venueId: messagesFrom(fields.venueId),
      lines: messagesFrom(fields.lines),
      expectedAttendance: messagesFrom(fields.expectedAttendance),
      roomLayout: messagesFrom(fields.roomLayout),
      accessibilityRequired: messagesFrom(fields.accessibilityRequired),
      accessibilityNotes: messagesFrom(fields.accessibilityNotes),
    },
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
 * be picked. SCRUM-266: a line's end list offers only times after its start,
 * and the end is cleared when the start moves to or past it.
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
 *
 * SCRUM-230 AC1: an optional section for the venue's own attendance, layout
 * and accessibility needs; AC2: each one left empty uses the event's, which the
 * field shows. The form does not check them itself (noValidate), so a refused
 * attendance shows the API's message beside the field, as for the event's own.
 *
 * SCRUM-229 AC1: the same form starts a replacement request. The page passes
 * the affected booking's date and times as `eventPeriod`, and the booking it
 * replaces as `replacesBookingId`. `idPrefix` keeps its element ids apart from
 * the main form's when both are on the page.
 */
export function RequestVenueBookingForm({
  requestId,
  venues,
  eventPeriod,
  eventRequirements,
  replacesBookingId,
  idPrefix = 'venue-booking',
}: {
  requestId: string;
  venues: readonly VenueOption[];
  eventPeriod: EventPeriod;
  eventRequirements: EventRequirements;
  replacesBookingId?: string;
  idPrefix?: string;
}) {
  const router = useRouter();
  const firstLine = (): Line => ({ date: eventPeriod.date ?? '', start: eventPeriod.start ?? '', end: eventPeriod.end ?? '' });
  // SCRUM-229 AC1: a replacement leaves the venue to choose, rather than
  // starting on the first in the list (which may be the affected one).
  const [venueId, setVenueId] = useState(replacesBookingId ? '' : (venues[0]?.id ?? ''));
  const [lines, setLines] = useState<Line[]>(() => [firstLine()]);
  const [own, setOwn] = useState<OwnRequirements>(NO_OWN_REQUIREMENTS);
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
        body: JSON.stringify({
          venueId,
          lines,
          // SCRUM-230: null is "use the event's" (AC2).
          expectedAttendance: own.expectedAttendance === '' ? null : Number(own.expectedAttendance),
          roomLayout: own.roomLayout === '' ? null : own.roomLayout,
          accessibilityRequired: own.accessibility === '' ? null : own.accessibility === 'yes',
          accessibilityNotes: own.accessibility === 'yes' ? own.accessibilityNotes : null,
          // SCRUM-229: the affected booking this request replaces, if any.
          replacesBookingId: replacesBookingId ?? null,
        }),
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
      setOwn(NO_OWN_REQUIREMENTS);
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
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div>
        <label className="block text-sm font-medium" htmlFor={`${idPrefix}-venue`}>
          Venue
        </label>
        <select
          id={`${idPrefix}-venue`}
          value={venueId}
          onChange={(event) => setVenueId(event.target.value)}
          aria-invalid={fieldErrors.fieldErrors.venueId ? true : undefined}
          aria-describedby={fieldErrors.fieldErrors.venueId ? `${idPrefix}-venue-error` : undefined}
          className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {replacesBookingId ? <option value="">Choose a venue</option> : null}
          {venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
        <FieldError id={`${idPrefix}-venue-error`} messages={fieldErrors.fieldErrors.venueId} />
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Dates and times needed</p>
        {lines.map((line, index) => {
          const lineErrors = fieldErrors.lineErrors[index] ?? {};
          return (
            <div key={index} className="rounded-md border border-[var(--border)] p-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-date-${index}`}>
                    Date
                  </label>
                  <input
                    id={`${idPrefix}-date-${index}`}
                    type="date"
                    max="9999-12-31"
                    value={line.date}
                    onChange={(event) => updateLine(index, { date: event.target.value })}
                    aria-invalid={lineErrors.date ? true : undefined}
                    aria-describedby={lineErrors.date ? `${idPrefix}-date-${index}-error` : undefined}
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
              <FieldError id={`${idPrefix}-date-${index}-error`} messages={lineErrors.date} />

              <div className="mt-2 flex flex-wrap gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-start-${index}`}>
                    Start time
                  </label>
                  <select
                    id={`${idPrefix}-start-${index}`}
                    value={line.start}
                    onChange={(event) =>
                      updateLine(index, { start: event.target.value, end: keepEndAfterStart(event.target.value, line.end) })
                    }
                    aria-invalid={lineErrors.start ? true : undefined}
                    aria-describedby={lineErrors.start ? `${idPrefix}-start-${index}-error` : undefined}
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
                  <label className="block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-end-${index}`}>
                    End time
                  </label>
                  <select
                    id={`${idPrefix}-end-${index}`}
                    value={line.end}
                    onChange={(event) => updateLine(index, { end: event.target.value })}
                    aria-invalid={lineErrors.end ? true : undefined}
                    aria-describedby={lineErrors.end ? `${idPrefix}-end-${index}-error` : undefined}
                    className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                  >
                    <option value="">Choose</option>
                    {endTimesAfter(line.start).map((time) => (
                      <option key={time} value={time}>
                        {time}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <FieldError id={`${idPrefix}-start-${index}-error`} messages={lineErrors.start} />
              <FieldError
                id={`${idPrefix}-end-${index}-error`}
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

      {/* SCRUM-230 AC1, AC2: this venue's own needs, each falling back to the event's. */}
      <fieldset className="space-y-3 rounded-md border border-[var(--border)] p-3">
        <legend className="px-1 text-sm font-medium">Venue requirements for this venue</legend>
        <p className="text-xs text-[var(--text-muted)]">Leave any of these empty to use the event&apos;s.</p>
        <div>
          <label className="block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-attendance`}>
            Expected attendance
          </label>
          <input
            id={`${idPrefix}-attendance`}
            type="number"
            min={1}
            step={1}
            value={own.expectedAttendance}
            placeholder={
              eventRequirements.expectedAttendance === null
                ? "Event's: not provided"
                : `Event's: ${eventRequirements.expectedAttendance}`
            }
            onChange={(event) => setOwn({ ...own, expectedAttendance: event.target.value })}
            aria-invalid={fieldErrors.fieldErrors.expectedAttendance ? true : undefined}
            aria-describedby={fieldErrors.fieldErrors.expectedAttendance ? `${idPrefix}-attendance-error` : undefined}
            className="mt-1 w-40 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
          <FieldError id={`${idPrefix}-attendance-error`} messages={fieldErrors.fieldErrors.expectedAttendance} />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-layout`}>
            Room layout
          </label>
          <select
            id={`${idPrefix}-layout`}
            value={own.roomLayout}
            onChange={(event) => setOwn({ ...own, roomLayout: event.target.value })}
            aria-invalid={fieldErrors.fieldErrors.roomLayout ? true : undefined}
            aria-describedby={fieldErrors.fieldErrors.roomLayout ? `${idPrefix}-layout-error` : undefined}
            className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">Use the event&apos;s ({eventRequirements.roomLayout})</option>
            {ROOM_LAYOUTS.map((layout) => (
              <option key={layout} value={layout}>
                {ROOM_LAYOUT_LABELS[layout]}
              </option>
            ))}
          </select>
          <FieldError id={`${idPrefix}-layout-error`} messages={fieldErrors.fieldErrors.roomLayout} />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-accessibility`}>
            Accessibility needs
          </label>
          <select
            id={`${idPrefix}-accessibility`}
            value={own.accessibility}
            onChange={(event) => setOwn({ ...own, accessibility: event.target.value as OwnRequirements['accessibility'] })}
            className="mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">Use the event&apos;s ({eventRequirements.accessibility})</option>
            <option value="yes">Yes, needed for this venue</option>
            <option value="no">None for this venue</option>
          </select>
          <FieldError id={`${idPrefix}-accessibility-error`} messages={fieldErrors.fieldErrors.accessibilityRequired} />
          {own.accessibility === 'yes' ? (
            <>
              <label className="mt-2 block text-xs text-[var(--text-muted)]" htmlFor={`${idPrefix}-accessibility-notes`}>
                What is needed
              </label>
              <textarea
                id={`${idPrefix}-accessibility-notes`}
                value={own.accessibilityNotes}
                onChange={(event) => setOwn({ ...own, accessibilityNotes: event.target.value })}
                aria-invalid={fieldErrors.fieldErrors.accessibilityNotes ? true : undefined}
                aria-describedby={
                  fieldErrors.fieldErrors.accessibilityNotes ? `${idPrefix}-accessibility-notes-error` : undefined
                }
                rows={2}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              />
              <FieldError
                id={`${idPrefix}-accessibility-notes-error`}
                messages={fieldErrors.fieldErrors.accessibilityNotes}
              />
            </>
          ) : null}
        </div>
      </fieldset>

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
