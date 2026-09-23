'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  OPERATING_SLOTS,
  OPERATING_SLOT_LABELS,
  ROOM_LAYOUTS,
  ROOM_LAYOUT_LABELS,
  type OperatingSlot,
  type RoomLayout,
  type VenueDetail,
  type VenueFormOptions,
} from '@/domain/venues/schema';
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
 *
 * Capacity inputs are type="text" with a numeric hint rather than
 * type="number". A number input makes it impossible to type "abc", which would
 * make US-11.1-TC03 unexercisable by hand. Validation is the server's job.
 */

type LayoutRow = { layout: RoomLayout; capacity: string };

type ApiErrorBody = { error?: string; message?: string; details?: unknown };

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

  // SCRUM-116 AC4: a new venue starts with all three slots selected.
  const [slots, setSlots] = useState<OperatingSlot[]>(venue ? venue.operatingSlots : [...OPERATING_SLOTS]);

  const [facilityIds, setFacilityIds] = useState<string[]>(
    venue ? venue.facilities.map((facility) => facility.id) : [],
  );
  const [featureIds, setFeatureIds] = useState<string[]>(
    venue ? venue.accessibilityFeatures.map((feature) => feature.id) : [],
  );
  const [layouts, setLayouts] = useState<LayoutRow[]>(
    venue ? venue.layouts.map((row) => ({ layout: row.layout, capacity: String(row.capacity) })) : [],
  );

  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  function addLayout() {
    const used = new Set(layouts.map((row) => row.layout));
    const next = ROOM_LAYOUTS.find((layout) => !used.has(layout));
    if (next) setLayouts([...layouts, { layout: next, capacity: '' }]);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});
    setFormError(null);

    const payload = {
      name,
      locationId,
      maxCapacity: capacityToSend(maxCapacity),
      operatingSlots: slots,
      facilityIds,
      accessibilityFeatureIds: featureIds,
      layouts: layouts.map((row) => ({ layout: row.layout, capacity: capacityToSend(row.capacity) })),
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
        const perField = fieldErrorsFrom(error.details);

        // SCRUM-116 AC2: a duplicate name is a problem with the name field,
        // so flag it there rather than only at the top of the form.
        if (error.error === 'CONFLICT' && error.message) {
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
            <div key={row.layout} className="flex flex-wrap items-center gap-2">
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
                {ROOM_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
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
