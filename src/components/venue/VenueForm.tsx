'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  AffectedBookingsDetailsSchema,
  SetupTurnaroundClashesDetailsSchema,
  OPERATING_SLOTS,
  OPERATING_SLOT_LABELS,
  ROOM_LAYOUTS,
  ROOM_LAYOUT_LABELS,
  type AffectedBookingsDetails,
  type SetupTurnaroundClashesDetails,
  type OperatingSlot,
  type RoomLayout,
  type VenueDetail,
  type VenueFormOptions,
} from '@/domain/venues/schema';
import { formatSingaporeDate } from '@/domain/shared/dates';
import { capacityToSend } from './capacityInput';

/**
 * Add and edit a venue. Shared by /venues/new and /venues/[id]/edit, because
 * the two forms differ only in what they start from and where they submit.
 *
 * SCRUM-116 AC1 name, location from the maintained list, maximum capacity
 * SCRUM-116 AC3 a bad capacity flags the field, so errors render per field
 * SCRUM-116 AC4 slot checkboxes, all three ticked by default on a new venue
 * SCRUM-117 AC1, AC2 facilities and accessibility features
 * SCRUM-117 AC3 editing submits the full list, so unticking removes
 * SCRUM-118 AC1 layouts, each with its own capacity
 * SCRUM-120 AC1 editing saves changed values
 * SCRUM-120 AC2 a capacity cut that affects confirmed future bookings lists
 *               them and is only applied once the editor confirms
 * SCRUM-225 AC1 setup and turnaround minutes, on the edit form (the card is
 *               about editing; a new venue starts at 0 and 0, AC3)
 * SCRUM-225 AC2 a bad value flags its own field
 * SCRUM-225 AC4 a change that makes confirmed bookings clash lists them and
 *               is only applied once the editor confirms
 *
 * Capacity inputs are type="text" with a numeric hint rather than
 * type="number". A number input makes it impossible to type "abc", which would
 * make US-11.1-TC03 unexercisable by hand. Validation is the server's job.
 */

/**
 * `key` identifies the row for React and never changes. Keying by the layout
 * itself meant changing a row's layout remounted it, so a keyboard user lost
 * focus on every change (found reviewing SCRUM-215).
 */
type LayoutRow = { key: number; layout: RoomLayout; capacity: string };

type ApiErrorBody = { error?: string; message?: string; details?: unknown };

/**
 * What the editor has confirmed so far: a capacity cut (SCRUM-120 AC2) and a
 * setup and turnaround change (SCRUM-225 AC4). A save can need both, one
 * after the other, so the first confirmation is kept while the second is
 * asked. Each only counts while the form still holds the values confirmed.
 */
type Confirmations = {
  cut: number | null;
  times: { setupMinutes: number; turnaroundMinutes: number } | null;
};

/** Pulls Zod's flattened fieldErrors out of an error body without casting to any. */
function fieldErrorsFrom(details: unknown): Record<string, string[]> {
  if (typeof details !== 'object' || details === null) return {};
  const flattened = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof flattened !== 'object' || flattened === null) return {};

  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(flattened as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      const strings = messages.filter((message): message is string => typeof message === 'string');
      if (strings.length > 0) result[field] = strings;
    }
  }
  return result;
}

/** The duplicate-name 409 names the venue; the changed-since-opened 409 does not. */
function isNameConflict(details: unknown): boolean {
  return typeof details === 'object' && details !== null && 'name' in details;
}

function FieldError({ messages }: { messages: string[] | undefined }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-[var(--danger)]">
      {messages.join(' ')}
    </p>
  );
}

export default function VenueForm({
  options,
  venue,
}: {
  options: VenueFormOptions;
  venue?: VenueDetail;
}) {
  const router = useRouter();
  const isEdit = venue !== undefined;

  const [name, setName] = useState(venue?.name ?? '');
  const [locationId, setLocationId] = useState(venue?.location.id ?? '');
  const [maxCapacity, setMaxCapacity] = useState(venue ? String(venue.maxCapacity) : '');

  // SCRUM-225 AC1: minutes of setup before an event and turnaround after it.
  // Text inputs like capacity, so a bad value reaches the server and is named
  // there (AC2). Only on the edit form.
  const [setupMinutes, setSetupMinutes] = useState(venue ? String(venue.setupMinutes) : '0');
  const [turnaroundMinutes, setTurnaroundMinutes] = useState(venue ? String(venue.turnaroundMinutes) : '0');

  // SCRUM-116 AC4: a new venue starts with all three slots selected.
  const [slots, setSlots] = useState<OperatingSlot[]>(venue ? venue.operatingSlots : [...OPERATING_SLOTS]);

  const [facilityIds, setFacilityIds] = useState<string[]>(
    venue ? venue.facilities.map((facility) => facility.id) : [],
  );
  const [featureIds, setFeatureIds] = useState<string[]>(
    venue ? venue.accessibilityFeatures.map((feature) => feature.id) : [],
  );
  const [layouts, setLayouts] = useState<LayoutRow[]>(() =>
    venue
      ? venue.layouts.map((row, index) => ({ key: index, layout: row.layout, capacity: String(row.capacity) }))
      : [],
  );
  // Keys for rows added later start after the ones the venue loaded with.
  const nextLayoutKey = useRef(venue ? venue.layouts.length : 0);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // SCRUM-120 AC2: the bookings a capacity cut would affect, shown until the
  // editor confirms the cut or changes the form.
  const [affected, setAffected] = useState<AffectedBookingsDetails | null>(null);
  // SCRUM-225 AC4: the bookings a setup or turnaround change makes clash.
  const [clashes, setClashes] = useState<SetupTurnaroundClashesDetails | null>(null);
  const [confirmed, setConfirmed] = useState<Confirmations>({ cut: null, times: null });

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  function addLayout() {
    const used = new Set(layouts.map((row) => row.layout));
    const next = ROOM_LAYOUTS.find((layout) => !used.has(layout));
    if (next) {
      const key = nextLayoutKey.current;
      nextLayoutKey.current += 1;
      setLayouts([...layouts, { key, layout: next, capacity: '' }]);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await save(confirmed);
  }

  /**
   * SCRUM-120 AC2: confirm the cut the editor was shown. If the capacity has
   * been changed since, it is a different cut with possibly different bookings,
   * so save() sends it unconfirmed and it is checked again rather than
   * confirmed blind.
   */
  async function confirmCut() {
    if (!affected) return;
    const next = { ...confirmed, cut: affected.maxCapacity };
    setConfirmed(next);
    await save(next);
  }

  /** SCRUM-225 AC4: confirm the setup and turnaround change, the same way. */
  async function confirmTimes() {
    if (!clashes) return;
    const next = {
      ...confirmed,
      times: { setupMinutes: clashes.setupMinutes, turnaroundMinutes: clashes.turnaroundMinutes },
    };
    setConfirmed(next);
    await save(next);
  }

  async function save(confirmations: Confirmations) {
    setSaving(true);
    setFieldErrors({});
    setFormError(null);
    setAffected(null);
    setClashes(null);

    // capacityToSend converts any whole number typed into a box, not only a
    // capacity: minutes go the same way, so "15.5" or "abc" reaches the server
    // as typed and is refused there with the field named.
    const capacity = capacityToSend(maxCapacity);
    const setup = capacityToSend(setupMinutes);
    const turnaround = capacityToSend(turnaroundMinutes);
    const confirmsCut = confirmations.cut !== null && capacity === confirmations.cut;
    const confirmsTimes =
      confirmations.times !== null &&
      setup === confirmations.times.setupMinutes &&
      turnaround === confirmations.times.turnaroundMinutes;

    const payload = {
      name,
      locationId,
      maxCapacity: capacity,
      operatingSlots: slots,
      facilityIds,
      accessibilityFeatureIds: featureIds,
      layouts: layouts.map((row) => ({ layout: row.layout, capacity: capacityToSend(row.capacity) })),
      // SCRUM-120: the version this form was loaded with, so a save from a
      // form that has gone out of date is refused instead of undoing someone
      // else's newer save.
      ...(isEdit && { expectedUpdatedAt: venue.updatedAt, setupMinutes: setup, turnaroundMinutes: turnaround }),
      ...(confirmsCut && { confirmAffectedBookings: true }),
      ...(confirmsTimes && { confirmSetupTurnaroundChange: true }),
    };

    try {
      const response = await fetch(isEdit ? `/api/venues/${venue.id}` : '/api/venues', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body: unknown = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = body as ApiErrorBody;

        // SCRUM-120 AC2: not an error in the form, a question for the editor.
        const cut = AffectedBookingsDetailsSchema.safeParse(error.details);
        if (error.error === 'CONFLICT' && cut.success) {
          setAffected(cut.data);
          setSaving(false);
          return;
        }

        // SCRUM-225 AC4: the same, for a setup or turnaround change.
        const clash = SetupTurnaroundClashesDetailsSchema.safeParse(error.details);
        if (error.error === 'CONFLICT' && clash.success) {
          setClashes(clash.data);
          setSaving(false);
          return;
        }

        const perField = fieldErrorsFrom(error.details);

        // SCRUM-116 AC2: a duplicate name is a problem with the name field,
        // so flag it there rather than only at the top of the form. The other
        // 409, a venue changed since this form was opened, is about the whole
        // form, so it stays at the top.
        if (error.error === 'CONFLICT' && error.message && isNameConflict(error.details)) {
          perField.name = [error.message];
        }

        setFieldErrors(perField);
        setFormError(Object.keys(perField).length > 0 ? null : (error.message ?? 'The venue could not be saved.'));
        setSaving(false);
        return;
      }

      // Saved. The button stays on "Saving..." until the next page replaces
      // this form: turning it back on here let a second click send the same
      // request again while that page was still loading.
      const saved = body as { venue?: { id?: string } };
      const savedId = saved.venue?.id ?? venue?.id;
      router.push(savedId ? `/venues/${savedId}` : '/venues');
      router.refresh();
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
      {formError && (
        <p role="alert" className="rounded border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {formError}
        </p>
      )}

      <div>
        <label htmlFor="venue-name" className="mb-1 block text-sm font-medium">
          Venue name
        </label>
        <input
          id="venue-name"
          className={inputClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <FieldError messages={fieldErrors.name} />
      </div>

      {/* SCRUM-116 AC1: the location comes from the maintained list, never free text. */}
      <div>
        <label htmlFor="venue-location" className="mb-1 block text-sm font-medium">
          Location
        </label>
        <select
          id="venue-location"
          className={inputClass}
          value={locationId}
          onChange={(event) => setLocationId(event.target.value)}
        >
          <option value="">Choose a location</option>
          {options.locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.locationId} />
      </div>

      <div>
        <label htmlFor="venue-capacity" className="mb-1 block text-sm font-medium">
          Maximum capacity
        </label>
        <input
          id="venue-capacity"
          className={inputClass}
          inputMode="numeric"
          value={maxCapacity}
          onChange={(event) => setMaxCapacity(event.target.value)}
        />
        <FieldError messages={fieldErrors.maxCapacity} />
      </div>

      {/* SCRUM-225 AC1: replaces SCRUM-119's yes/no slot flags. */}
      {isEdit && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Setup and turnaround</legend>
          <p className="text-sm text-[var(--text-muted)]">
            Whole minutes in 15-minute steps (0, 15, 30, 45 and so on). The venue is committed for this long
            before and after every booking.
          </p>
          <div>
            <label htmlFor="venue-setup-minutes" className="mb-1 block text-sm">
              Setup time (minutes)
            </label>
            <input
              id="venue-setup-minutes"
              className={inputClass}
              inputMode="numeric"
              value={setupMinutes}
              onChange={(event) => setSetupMinutes(event.target.value)}
            />
            <FieldError messages={fieldErrors.setupMinutes} />
          </div>
          <div>
            <label htmlFor="venue-turnaround-minutes" className="mb-1 block text-sm">
              Turnaround time (minutes)
            </label>
            <input
              id="venue-turnaround-minutes"
              className={inputClass}
              inputMode="numeric"
              value={turnaroundMinutes}
              onChange={(event) => setTurnaroundMinutes(event.target.value)}
            />
            <FieldError messages={fieldErrors.turnaroundMinutes} />
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Operating slots</legend>
        <p className="mb-2 text-sm text-[var(--text-muted)]">
          The selected slots apply to every day of the week.
        </p>
        <div className="flex flex-wrap gap-4">
          {OPERATING_SLOTS.map((slot) => (
            <label key={slot} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={slots.includes(slot)}
                onChange={() => setSlots(toggle(slots, slot))}
              />
              {OPERATING_SLOT_LABELS[slot]}
            </label>
          ))}
        </div>
        <FieldError messages={fieldErrors.operatingSlots} />
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Facilities</legend>
        <div className="flex flex-wrap gap-4">
          {options.facilities.map((facility) => (
            <label key={facility.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={facilityIds.includes(facility.id)}
                onChange={() => setFacilityIds(toggle(facilityIds, facility.id))}
              />
              {facility.name}
            </label>
          ))}
        </div>
        <FieldError messages={fieldErrors.facilityIds} />
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Accessibility features</legend>
        <div className="flex flex-wrap gap-4">
          {options.accessibilityFeatures.map((feature) => (
            <label key={feature.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={featureIds.includes(feature.id)}
                onChange={() => setFeatureIds(toggle(featureIds, feature.id))}
              />
              {feature.name}
            </label>
          ))}
        </div>
        <FieldError messages={fieldErrors.accessibilityFeatureIds} />
      </fieldset>

      {/* SCRUM-118 AC1: each supported layout carries its own capacity. */}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Supported layouts</legend>
        {layouts.length === 0 && (
          <p className="mb-2 text-sm text-[var(--text-muted)]">No layouts recorded.</p>
        )}
        <div className="flex flex-col gap-2">
          {layouts.map((row, index) => (
            <div key={row.key} className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Layout"
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                value={row.layout}
                onChange={(event) =>
                  setLayouts(
                    layouts.map((existing, position) =>
                      position === index
                        ? { ...existing, layout: event.target.value as RoomLayout }
                        : existing,
                    ),
                  )
                }
              >
                {/* A layout another row already has is shown but not offered:
                    each layout can only be added once per venue. */}
                {ROOM_LAYOUTS.map((layout) => (
                  <option
                    key={layout}
                    value={layout}
                    disabled={layout !== row.layout && layouts.some((other) => other.layout === layout)}
                  >
                    {ROOM_LAYOUT_LABELS[layout]}
                  </option>
                ))}
              </select>
              <input
                aria-label={`${ROOM_LAYOUT_LABELS[row.layout]} capacity`}
                className="w-32 rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
                inputMode="numeric"
                placeholder="Capacity"
                value={row.capacity}
                onChange={(event) =>
                  setLayouts(
                    layouts.map((existing, position) =>
                      position === index ? { ...existing, capacity: event.target.value } : existing,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="text-sm text-[var(--danger)] underline"
                onClick={() => setLayouts(layouts.filter((_, position) => position !== index))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {layouts.length < ROOM_LAYOUTS.length && (
          <button type="button" onClick={addLayout} className="mt-2 text-sm text-[var(--brand)] underline">
            Add layout
          </button>
        )}
        <FieldError messages={fieldErrors.layouts} />
      </fieldset>

      {affected && (
        <section
          role="alert"
          aria-labelledby="affected-bookings-heading"
          className="rounded border border-[var(--danger)] p-4 text-sm"
        >
          <h2 id="affected-bookings-heading" className="font-semibold">
            Lowering the maximum capacity to {affected.maxCapacity} affects{' '}
            {affected.bookings.length === 1 ? '1 confirmed booking' : `${affected.bookings.length} confirmed bookings`}
          </h2>
          <p className="mt-1 text-[var(--text-muted)]">
            Each of these events expects more attendees than the new maximum. If you confirm, the change is applied
            and the coordinator assigned to each event is notified.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {affected.bookings.map((booking) => (
              <li key={booking.eventId} className="rounded border border-[var(--border)] p-2">
                <span className="font-medium">{booking.reference}</span> {booking.eventName}
                <br />
                {booking.proposedDate} · {booking.expectedAttendance} expected
                {booking.coordinatorId === null && ' · no coordinator assigned yet'}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={confirmCut}
              disabled={saving}
              className="rounded bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Confirm and save'}
            </button>
            <button type="button" onClick={() => setAffected(null)} className="text-sm underline">
              Go back and edit
            </button>
          </div>
        </section>
      )}

      {clashes && (
        <section
          role="alert"
          aria-labelledby="setup-turnaround-clashes-heading"
          className="rounded border border-[var(--danger)] p-4 text-sm"
        >
          <h2 id="setup-turnaround-clashes-heading" className="font-semibold">
            A setup time of {clashes.setupMinutes} minutes and a turnaround time of {clashes.turnaroundMinutes}{' '}
            minutes make {clashes.bookings.length} confirmed bookings clash
          </h2>
          <p className="mt-1 text-[var(--text-muted)]">
            With the new times, these bookings no longer leave the venue enough time to set up and reset between
            them. If you confirm, the change is applied, every booking stays confirmed, and each one listed is
            flagged as affected.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {clashes.bookings.map((booking) => (
              <li key={booking.bookingId} className="rounded border border-[var(--border)] p-2">
                <span className="font-medium">{booking.reference}</span> {booking.eventName}
                <br />
                {formatSingaporeDate(booking.date)} · {booking.start}-{booking.end}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={confirmTimes}
              disabled={saving}
              className="rounded bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Confirm and save'}
            </button>
            <button type="button" onClick={() => setClashes(null)} className="text-sm underline">
              Go back and edit
            </button>
          </div>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {saving ? 'Saving...' : isEdit ? 'Save changes' : 'Create venue'}
        </button>
        <button
          type="button"
          onClick={() => router.push(isEdit ? `/venues/${venue.id}` : '/venues')}
          className="text-sm underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
