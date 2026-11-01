'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { hasLongYear, LATEST_DATE } from '@/domain/shared/dates';
import { END_OF_DAY, START_TIME_OPTIONS, endTimesAfter, keepEndAfterStart } from '@/domain/shared/times';
import { ROOM_LAYOUTS, ROOM_LAYOUT_LABELS, type RoomLayout } from '@/domain/venues/schema';
import type { VenueRequirementOptions } from '@/domain/event-request/service';

/**
 * SCRUM-76 AC1 — the blank request form, with the client organisation already
 * filled in and not editable.
 *
 * Saving never checks the proposed date (AC3): an organiser may keep a request
 * with a date they still have to fix. The date rule is applied at submission
 * (SCRUM-82), which happens from the saved request's own page, not this form.
 *
 * SCRUM-238 AC1 — start and end are chosen from lists built from
 * START_TIME_OPTIONS / END_TIME_OPTIONS, so only :00, :15, :30 and :45 can be
 * picked. A select rather than <input type="time">, whose `step` the browser
 * may not enforce in its picker and which cannot show 24:00 (the end of a
 * former Night slot, AC6). Nothing crossing midnight can be chosen: the last
 * end on offer is 24:00. Replaces SCRUM-77's slot checkboxes.
 *
 * SCRUM-266 — the end list offers only times after the chosen start, and the
 * end is cleared when the start moves to or past it (endTimesAfter,
 * keepEndAfterStart). The server's check (AC2) still refuses a bad range.
 *
 * SCRUM-78 — expected attendance, same permissive-save/strict-submit pattern
 * as the date and times above: blank is fine to save, and is only enforced as
 * a mandatory field at submission (SCRUM-82's incompleteFields()).
 *
 * SCRUM-79 — venue requirements. AC1: the layout select is built from the
 * venue catalogue's ROOM_LAYOUTS, so the seven it offers are exactly the seven
 * a venue can be recorded as supporting. AC2/AC3: accessibility is a yes/none
 * answer first; only "yes" opens the feature list (the maintained one, passed
 * in as `options`) and the notes. AC4: the location select's blank option IS
 * the "no preference" answer. Nothing here is mandatory.
 *
 * SCRUM-80 — equipment follows the accessibility pattern (yes/none, then an
 * item list). The technical support box sits outside that toggle on purpose:
 * AC2 says it is saved whether or not any item is listed.
 *
 * SCRUM-81 — registration is one explicit yes/no, sent on every save so that
 * unmarking it on a draft overwrites what was stored (AC3).
 */

const labelClass = 'block text-sm font-medium text-[var(--text)]';
const fieldClass =
  'mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm ' +
  'focus:border-[var(--brand)] focus:outline-none';

/**
 * SCRUM-83 / SCRUM-85 — the same form serves three jobs, because they are the
 * same fields: a blank new request, "Save as draft" on either, and resuming a
 * saved draft with `initial` pre-filled (SCRUM-85 AC3).
 */
export interface EventRequestFormInitialValues {
  name: string;
  purpose: string;
  description: string;
  proposedDate: string;
  /** SCRUM-238. `HH:MM`; '' while not chosen. */
  startTime: string;
  endTime: string;
  expectedAttendance: string;
  /** SCRUM-79 AC1. '' while no layout has been chosen. */
  roomLayout: RoomLayout | '';
  /** SCRUM-79 AC2/AC3. '' while unanswered; 'no' is the explicit "none". */
  accessibilityRequired: '' | 'yes' | 'no';
  accessibilityFeatureIds: string[];
  accessibilityNotes: string;
  /** SCRUM-79 AC4. '' is "no preference". */
  preferredLocationId: string;
  /** SCRUM-80 AC1/AC3. '' while unanswered; 'no' is the explicit "none". */
  equipmentRequired: '' | 'yes' | 'no';
  /** Quantity kept as text, like expectedAttendance: '' is "not entered". */
  equipmentItems: { item: string; quantity: string }[];
  /** SCRUM-80 AC2. */
  technicalSupportNotes: string;
  /** SCRUM-81. '' while unanswered. */
  registrationRequired: '' | 'yes' | 'no';
}

export function EventRequestForm({
  clientOrganisation,
  today,
  options,
  initial,
  requestId,
}: {
  /** Null until the Client Organisations story lands (SCRUM-76 AC1 is blocked on it). */
  clientOrganisation: { id: string; name: string } | null;
  /** Today in Singapore, from the server, so the picker agrees with the rules. */
  today: string;
  /** SCRUM-79 — the maintained lists the venue-requirement choices come from. */
  options: VenueRequirementOptions;
  /** SCRUM-85 AC3 — every value previously entered on a resumed draft. */
  initial?: EventRequestFormInitialValues;
  /** Set when resuming a saved draft: the draft this form writes back to. */
  requestId?: string;
}) {
  const router = useRouter();

  const [name, setName] = useState(initial?.name ?? '');
  const [purpose, setPurpose] = useState(initial?.purpose ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [proposedDate, setProposedDate] = useState(initial?.proposedDate ?? '');
  // SCRUM-238. '' is "not yet chosen", read as blank by the server.
  const [startTime, setStartTime] = useState(initial?.startTime ?? '');
  const [endTime, setEndTime] = useState(initial?.endTime ?? '');
  // Kept as a string, like proposedDate: an empty input is a valid "not yet
  // entered" save-time state, not a 0. Converted to a number only when sent.
  const [expectedAttendance, setExpectedAttendance] = useState(initial?.expectedAttendance ?? '');
  // SCRUM-79
  const [roomLayout, setRoomLayout] = useState<RoomLayout | ''>(initial?.roomLayout ?? '');
  const [accessibilityRequired, setAccessibilityRequired] = useState<'' | 'yes' | 'no'>(
    initial?.accessibilityRequired ?? '',
  );
  const [accessibilityFeatureIds, setAccessibilityFeatureIds] = useState<string[]>(
    initial?.accessibilityFeatureIds ?? [],
  );
  const [accessibilityNotes, setAccessibilityNotes] = useState(initial?.accessibilityNotes ?? '');
  const [preferredLocationId, setPreferredLocationId] = useState(initial?.preferredLocationId ?? '');
  // SCRUM-80
  const [equipmentRequired, setEquipmentRequired] = useState<'' | 'yes' | 'no'>(
    initial?.equipmentRequired ?? '',
  );
  const [equipmentItems, setEquipmentItems] = useState<{ item: string; quantity: string }[]>(
    initial?.equipmentItems ?? [],
  );
  const [technicalSupportNotes, setTechnicalSupportNotes] = useState(
    initial?.technicalSupportNotes ?? '',
  );
  // SCRUM-81
  const [registrationRequired, setRegistrationRequired] = useState<'' | 'yes' | 'no'>(
    initial?.registrationRequired ?? '',
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  /**
   * What both saves send. Empty strings are sent as-is, not dropped: the
   * schema's own message for a blank field ("Purpose is required") is what
   * names the missing field. expectedAttendance is the one exception: an empty
   * string is not a valid number, so it is sent as undefined (JSON.stringify
   * drops the key) and the mandatory-field check, not a type error, is what
   * names it missing.
   */
  function requestBody() {
    return JSON.stringify({
      name,
      purpose,
      description,
      proposedDate,
      startTime,
      endTime,
      expectedAttendance: expectedAttendance === '' ? undefined : Number(expectedAttendance),
      // SCRUM-79. '' reads as "not stated" on the server (optionalFromBlank).
      roomLayout,
      // An unanswered radio is sent as undefined (dropped), a "none" as false:
      // AC3 needs "none" to reach the row as an answer, not as an absence.
      accessibilityRequired: accessibilityRequired === '' ? undefined : accessibilityRequired === 'yes',
      accessibilityFeatureIds,
      accessibilityNotes,
      // AC4: '' is "no preference", read as "not stated" on the server.
      preferredLocationId,
      // SCRUM-80. Same unanswered/none/yes encoding as accessibility. A row the
      // organiser added but never filled in is not a requirement, so it is not
      // sent; a half-filled one is, so the schema can name what is missing.
      equipmentRequired: equipmentRequired === '' ? undefined : equipmentRequired === 'yes',
      equipmentItems: equipmentItems
        .filter((row) => row.item.trim() !== '' || row.quantity !== '')
        .map((row) => ({
          item: row.item,
          quantity: row.quantity === '' ? undefined : Number(row.quantity),
        })),
      technicalSupportNotes,
      // SCRUM-81. Same encoding: undefined is unanswered, false is "not required".
      registrationRequired: registrationRequired === '' ? undefined : registrationRequired === 'yes',
    });
  }

  /**
   * SCRUM-83 AC1 — "Save as draft" keeps whatever is filled in and applies no
   * mandatory-field check. SCRUM-83 AC4 / SCRUM-85 AC3 — when this form is
   * already editing a saved draft it PATCHes that draft, so re-saving updates
   * it in place instead of creating a second one.
   */
  async function onSaveDraft() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const response = await fetch(
        requestId ? `/api/event-requests/${requestId}/draft` : '/api/event-requests/draft',
        {
          method: requestId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody(),
        },
      );

      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      } | null;

      if (!response.ok || !payload?.id) {
        setFieldErrors(payload?.details?.fieldErrors ?? {});
        throw new Error(payload?.message ?? 'The draft could not be saved.');
      }
      router.push(`/events/${payload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The draft could not be saved.');
      setSaving(false);
    }
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      // SCRUM-83 AC4 / SCRUM-85 — when this form is editing a saved draft, the
      // full save updates that draft too. Posting would leave a second row
      // behind, which AC4 explicitly rules out.
      const response = await fetch(
        requestId ? `/api/event-requests/${requestId}` : '/api/event-requests',
        {
          method: requestId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody(),
        },
      );

      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
        details?: { fieldErrors?: Record<string, string[]> };
      } | null;

      if (!response.ok || !payload?.id) {
        setFieldErrors(payload?.details?.fieldErrors ?? {});
        throw new Error(payload?.message ?? 'The request could not be saved.');
      }
      router.push(`/events/${payload.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be saved.');
      setSaving(false);
    }
  }

  function toggleAccessibilityFeature(id: string) {
    setAccessibilityFeatureIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function updateEquipmentItem(index: number, patch: Partial<{ item: string; quantity: string }>) {
    setEquipmentItems((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function removeEquipmentItem(index: number) {
    setEquipmentItems((current) => current.filter((_, i) => i !== index));
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
        <label className={labelClass} htmlFor="organisation">
          Client organisation
        </label>
        <input
          id="organisation"
          className={`${fieldClass} bg-slate-50 text-[var(--text-muted)]`}
          value={clientOrganisation?.name ?? 'Not yet linked to an organisation'}
          readOnly
          aria-describedby="organisation-hint"
        />
        <p id="organisation-hint" className="mt-1 text-xs text-[var(--text-muted)]">
          {clientOrganisation
            ? 'Taken from your account. A request is always raised for your own organisation.'
            : 'Organisations are not set up yet. The request will be linked to yours once they are.'}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="name">
          Event name
        </label>
        <input
          id="name"
          className={fieldClass}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          required
        />
        <FieldError field="name" />
      </div>

      <div>
        <label className={labelClass} htmlFor="purpose">
          Purpose
        </label>
        <textarea
          id="purpose"
          className={fieldClass}
          rows={3}
          value={purpose}
          onChange={(event) => setPurpose(event.target.value)}
        />
        <FieldError field="purpose" />
      </div>

      <div>
        <label className={labelClass} htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          className={fieldClass}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <FieldError field="description" />
      </div>

      <div>
        <label className={labelClass} htmlFor="proposedDate">
          Proposed date
        </label>
        <input
          id="proposedDate"
          type="date"
          className={fieldClass}
          value={proposedDate}
          min={today}
          max={LATEST_DATE}
          // A date input takes a five- or six-digit year by default; keep the
          // field at four digits. The server refuses a longer year as well.
          onChange={(event) => {
            if (!hasLongYear(event.target.value)) setProposedDate(event.target.value);
          }}
          aria-describedby="proposedDate-hint"
        />
        <p id="proposedDate-hint" className="mt-1 text-xs text-[var(--text-muted)]">
          Singapore time. Must be today or later to submit; any date can be saved.
        </p>
        <FieldError field="proposedDate" />
      </div>

      <fieldset>
        <legend className={labelClass}>Time</legend>
        <div className="mt-1 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)]" htmlFor="startTime">
              Start
            </label>
            <select
              id="startTime"
              // AC2: a refused range marks both fields, not just one.
              className={`${fieldClass} ${fieldErrors.startTime?.length ? 'border-[var(--danger)]' : ''}`}
              value={startTime}
              onChange={(event) => {
                const start = event.target.value;
                setStartTime(start);
                setEndTime((end) => keepEndAfterStart(start, end));
              }}
              aria-invalid={Boolean(fieldErrors.startTime?.length)}
              aria-describedby="time-hint"
            >
              <option value="">Choose a start time</option>
              {START_TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
            <FieldError field="startTime" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)]" htmlFor="endTime">
              End
            </label>
            <select
              id="endTime"
              // AC2: a refused range marks both fields, not just one.
              className={`${fieldClass} ${fieldErrors.endTime?.length ? 'border-[var(--danger)]' : ''}`}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              aria-invalid={Boolean(fieldErrors.endTime?.length)}
              aria-describedby="time-hint"
            >
              <option value="">Choose an end time</option>
              {endTimesAfter(startTime).map((time) => (
                <option key={time} value={time}>
                  {time === END_OF_DAY ? '24:00 (midnight)' : time}
                </option>
              ))}
            </select>
            <FieldError field="endTime" />
          </div>
        </div>
        <p id="time-hint" className="mt-1 text-xs text-[var(--text-muted)]">
          Singapore time, in 15-minute steps. The end must be after the start. Both are needed to
          submit.
        </p>
      </fieldset>

      <div>
        <label className={labelClass} htmlFor="expectedAttendance">
          Expected attendance
        </label>
        <input
          id="expectedAttendance"
          type="number"
          min={1}
          step={1}
          className={fieldClass}
          value={expectedAttendance}
          onChange={(event) => setExpectedAttendance(event.target.value)}
          aria-describedby="expectedAttendance-hint"
        />
        <p id="expectedAttendance-hint" className="mt-1 text-xs text-[var(--text-muted)]">
          A single whole number for the whole event. Must be greater than 0 to submit; any value can be saved.
        </p>
        <FieldError field="expectedAttendance" />
      </div>

      {/* SCRUM-79 — venue requirements. None of these is needed to save or submit. */}
      <fieldset className="space-y-5 border-t border-[var(--border)] pt-5">
        <legend className="text-base font-semibold">Venue requirements</legend>
        <p className="-mt-3 text-xs text-[var(--text-muted)]">
          Optional. Tells the coordinator what to look for when finding a venue.
        </p>

        {/* AC1 — built from the catalogue's list, so only its seven layouts can be chosen. */}
        <div>
          <label className={labelClass} htmlFor="roomLayout">
            Room layout
          </label>
          <select
            id="roomLayout"
            className={fieldClass}
            value={roomLayout}
            onChange={(event) => setRoomLayout(event.target.value as RoomLayout | '')}
          >
            <option value="">Not yet chosen</option>
            {ROOM_LAYOUTS.map((layout) => (
              <option key={layout} value={layout}>
                {ROOM_LAYOUT_LABELS[layout]}
              </option>
            ))}
          </select>
          <FieldError field="roomLayout" />
        </div>

        {/* AC4 — from the maintained location list. Leaving it blank is a valid
            answer and is recorded as no preference. */}
        <div>
          <label className={labelClass} htmlFor="preferredLocationId">
            Preferred location
          </label>
          <select
            id="preferredLocationId"
            className={fieldClass}
            value={preferredLocationId}
            onChange={(event) => setPreferredLocationId(event.target.value)}
          >
            <option value="">No preference</option>
            {options.locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
          <FieldError field="preferredLocationId" />
        </div>

        {/* AC2/AC3 — the answer comes first. "None" is a real answer and is
            saved as one; the details only appear once the answer is "yes". */}
        <fieldset>
          <legend className={labelClass}>Accessibility requirements</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="accessibilityRequired"
                value="yes"
                checked={accessibilityRequired === 'yes'}
                onChange={() => setAccessibilityRequired('yes')}
              />
              Yes, this event has accessibility requirements
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="accessibilityRequired"
                value="no"
                checked={accessibilityRequired === 'no'}
                onChange={() => {
                  setAccessibilityRequired('no');
                  // Otherwise a feature list or notes typed while "Yes" was
                  // selected survive, hidden, and can still fail validation
                  // on save even though the visible answer is now "None".
                  setAccessibilityFeatureIds([]);
                  setAccessibilityNotes('');
                }}
              />
              None
            </label>
          </div>
          <FieldError field="accessibilityRequired" />

          {accessibilityRequired === 'yes' ? (
            <div className="mt-3 space-y-4 rounded-md border border-[var(--border)] bg-slate-50 p-3">
              <fieldset>
                <legend className="text-sm font-medium">Needed at the venue</legend>
                {options.accessibilityFeatures.length === 0 ? (
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    No accessibility features are on the list yet. Describe what you need below.
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
                    {options.accessibilityFeatures.map((feature) => (
                      <label key={feature.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={accessibilityFeatureIds.includes(feature.id)}
                          onChange={() => toggleAccessibilityFeature(feature.id)}
                        />
                        {feature.name}
                      </label>
                    ))}
                  </div>
                )}
                <FieldError field="accessibilityFeatureIds" />
              </fieldset>

              <div>
                <label className={labelClass} htmlFor="accessibilityNotes">
                  Anything else the coordinator should know
                </label>
                <textarea
                  id="accessibilityNotes"
                  className={fieldClass}
                  rows={3}
                  maxLength={1000}
                  value={accessibilityNotes}
                  onChange={(event) => setAccessibilityNotes(event.target.value)}
                />
                <FieldError field="accessibilityNotes" />
              </div>
            </div>
          ) : null}
        </fieldset>
      </fieldset>

      {/* SCRUM-80 — equipment and technical support. Optional, like the venue
          requirements above. */}
      <fieldset className="space-y-5 border-t border-[var(--border)] pt-5">
        <legend className="text-base font-semibold">Equipment and technical support</legend>
        <p className="-mt-3 text-xs text-[var(--text-muted)]">
          Optional. Recorded for the coordinator to pass to Technical Support.
        </p>

        {/* AC1/AC3 — the answer first; "None" is saved as an answer. */}
        <fieldset>
          <legend className={labelClass}>Equipment</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="equipmentRequired"
                value="yes"
                checked={equipmentRequired === 'yes'}
                onChange={() => setEquipmentRequired('yes')}
              />
              Yes, this event needs equipment
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="equipmentRequired"
                value="no"
                checked={equipmentRequired === 'no'}
                onChange={() => {
                  setEquipmentRequired('no');
                  // Otherwise an item typed while "Yes" was selected survives,
                  // hidden, and can still fail validation on save (e.g. an
                  // invalid quantity) even though the visible answer is now
                  // "None".
                  setEquipmentItems([]);
                }}
              />
              None
            </label>
          </div>
          <FieldError field="equipmentRequired" />

          {equipmentRequired === 'yes' ? (
            <div className="mt-3 space-y-3 rounded-md border border-[var(--border)] bg-slate-50 p-3">
              {equipmentItems.map((row, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[12rem] flex-1">
                    <label className={labelClass} htmlFor={`equipment-item-${index}`}>
                      Item
                    </label>
                    <input
                      id={`equipment-item-${index}`}
                      className={fieldClass}
                      value={row.item}
                      maxLength={100}
                      placeholder="e.g. Wireless microphone"
                      onChange={(event) => updateEquipmentItem(index, { item: event.target.value })}
                    />
                  </div>
                  <div className="w-24">
                    <label className={labelClass} htmlFor={`equipment-quantity-${index}`}>
                      Quantity
                    </label>
                    <input
                      id={`equipment-quantity-${index}`}
                      type="number"
                      min={1}
                      step={1}
                      className={fieldClass}
                      value={row.quantity}
                      onChange={(event) =>
                        updateEquipmentItem(index, { quantity: event.target.value })
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEquipmentItem(index)}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm hover:bg-slate-100"
                    aria-label={`Remove equipment item ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setEquipmentItems((current) => [...current, { item: '', quantity: '' }])
                }
                className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-medium hover:bg-slate-100"
              >
                Add item
              </button>
              <FieldError field="equipmentItems" />
            </div>
          ) : null}
        </fieldset>

        {/* AC2 — always shown: it is saved whether or not any item is listed. */}
        <div>
          <label className={labelClass} htmlFor="technicalSupportNotes">
            Technical support required
          </label>
          <textarea
            id="technicalSupportNotes"
            className={fieldClass}
            rows={3}
            maxLength={1000}
            value={technicalSupportNotes}
            onChange={(event) => setTechnicalSupportNotes(event.target.value)}
            aria-describedby="technicalSupportNotes-hint"
          />
          <p id="technicalSupportNotes-hint" className="mt-1 text-xs text-[var(--text-muted)]">
            Describe any set-up or on-the-day support needed, even if no equipment is listed.
          </p>
          <FieldError field="technicalSupportNotes" />
        </div>
      </fieldset>

      {/* SCRUM-81 — AC1/AC2: an explicit yes/no. AC3: on a draft, switching to
          "No" and saving overwrites the stored answer. */}
      <fieldset className="border-t border-[var(--border)] pt-5">
        <legend className="text-base font-semibold">Attendee registration</legend>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="registrationRequired"
              value="yes"
              checked={registrationRequired === 'yes'}
              onChange={() => setRegistrationRequired('yes')}
            />
            Yes, attendees will need to register
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="registrationRequired"
              value="no"
              checked={registrationRequired === 'no'}
              onChange={() => setRegistrationRequired('no')}
            />
            No registration needed
          </label>
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Registration is only set up for events that need it.
        </p>
        <FieldError field="registrationRequired" />
      </fieldset>

      {error ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save request'}
        </button>

        {/* SCRUM-83 AC1 — the other way to save: keeps whatever is filled in,
            with no mandatory-field check. */}
        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saving}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save as draft'}
        </button>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Only the event name is needed to save a draft. You can come back and finish it later.
      </p>
    </form>
  );
}