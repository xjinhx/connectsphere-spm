import { createAdminClient } from '@/lib/supabase/admin';
import {
  deleteEventRequestAccessibilityFeatures,
  deleteEventRequestEquipment,
  fetchEventRequest,
  insertEventRequest,
  insertEventRequestAccessibilityFeatures,
  insertEventRequestEquipment,
  listEventRequestsForOrganiser,
  markEventRequestSubmitted,
  updateEventRequest,
  type EventRequestRow,
  type EventRequestWrite,
  type ReferenceRow,
} from '@/lib/supabase/eventRequests';
import { fetchAccessibilityFeatures, fetchLocations } from '@/lib/supabase/venues';
import { getCurrentActor, type Actor } from '@/lib/auth/currentActor';
import { hasRole } from '@/domain/identity/policy';
import {
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from '@/domain/shared/errors';
import type { RoomLayout } from '@/domain/venues/schema';
import {
  eventRequestDraftSchema,
  eventRequestSaveSchema,
  type EquipmentItem,
  type EventRequestDraftInput,
  type EventRequestSaveInput,
  type EventRequestStatus,
  type VenueRequirementsInput,
} from './schema';
import { fromDatabaseTime, type ClockTime } from '@/domain/shared/times';
import {
  canBeSubmitted,
  canViewRequest,
  incompleteFields,
  isEditable,
  isOwnRequest,
  isResumable,
  normaliseAccessibility,
  normaliseEquipment,
} from './policy';

/**
 * SCRUM-76 — orchestration for creating and reading an event request.
 * SCRUM-82 — submitting one, and listing an organiser's own.
 * Decides who may act, applies the rules from policy.ts, then delegates the
 * actual Supabase calls to src/lib/supabase/eventRequests.ts.
 */

export interface EventRequest {
  id: string;
  reference: string;
  organiserId: string;
  /** Null until the Client Organisations story lands. */
  clientOrganisationId: string | null;
  name: string;
  purpose: string | null;
  description: string | null;
  proposedDate: string | null;
  /**
   * SCRUM-238. `HH:MM` Singapore clock time (AC7); null until entered. A
   * request saved as a slot reads back as that slot's times (AC6).
   */
  startTime: ClockTime | null;
  endTime: ClockTime | null;
  /** SCRUM-78's column, read here for SCRUM-82's completeness check. */
  expectedAttendance: number | null;
  // SCRUM-82
  status: EventRequestStatus;
  /** An instant. Render with formatSingaporeDateTime() (AC1). */
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // SCRUM-79
  /** AC1. Null until the organiser has chosen one. */
  roomLayout: RoomLayout | null;
  /** AC2/AC3. Null until answered; false is "none required". */
  accessibilityRequired: boolean | null;
  /** AC2. From the maintained list; empty unless accessibilityRequired is true. */
  accessibilityFeatures: ReferenceRow[];
  accessibilityNotes: string | null;
  /** AC4. From the maintained location list; null is "no preference". */
  preferredLocation: ReferenceRow | null;
  // SCRUM-80
  /** AC1/AC3. Null until answered; false is "none required". */
  equipmentRequired: boolean | null;
  /** AC1. In the order listed; empty unless equipmentRequired is true. */
  equipmentItems: EquipmentItem[];
  /** AC2. Kept whatever the equipment answer is. */
  technicalSupportNotes: string | null;
  // SCRUM-81
  /** AC1/AC2. Null until answered. */
  registrationRequired: boolean | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exported so domain/review/service.ts (SCRUM-89) can build its review shape
 * from the same mapping rather than a second one that could drift from this
 * one — "every field the Event Organiser supplied" (SCRUM-89 AC1) is exactly
 * what this already maps. Review-only columns (SCRUM-90's clarification_note
 * and friends) stay out of EventRequest itself, same as SCRUM-92 kept
 * decision/decidedBy/decidedAt in its own ApprovalOutcome/ApprovalView
 * instead of widening this interface.
 */
export function toEventRequest(row: EventRequestRow): EventRequest {
  return {
    id: row.id,
    reference: row.reference,
    organiserId: row.organiser_id,
    clientOrganisationId: row.client_organisation_id,
    name: row.name,
    purpose: row.purpose,
    description: row.description,
    proposedDate: row.proposed_date,
    startTime: row.start_time === null ? null : fromDatabaseTime(row.start_time),
    endTime: row.end_time === null ? null : fromDatabaseTime(row.end_time),
    expectedAttendance: row.expected_attendance,
    status: row.status,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // The database constraint guarantees only the seven catalogue layouts are stored.
    roomLayout: row.room_layout as RoomLayout | null,
    accessibilityRequired: row.accessibility_required,
    accessibilityFeatures: row.event_request_accessibility_features.flatMap((link) =>
      link.accessibility_features ? [link.accessibility_features] : [],
    ),
    accessibilityNotes: row.accessibility_notes,
    preferredLocation: row.preferred_location,
    equipmentRequired: row.equipment_required,
    // PostgREST does not promise an order for embedded rows; `position` does.
    equipmentItems: [...row.event_request_equipment]
      .sort((a, b) => a.position - b.position)
      .map(({ item, quantity }) => ({ item, quantity })),
    technicalSupportNotes: row.technical_support_notes,
    registrationRequired: row.registration_required,
  };
}

/**
 * SCRUM-79 / SCRUM-80 — the requirements as they are written, shared by the
 * full save and the draft save because both write the same row. A requirement
 * that was not stated is stored as NULL, never as an empty string.
 */
function toVenueRequirementsWrite(
  input: VenueRequirementsInput,
): Pick<
  EventRequestWrite,
  | 'room_layout'
  | 'accessibility_required'
  | 'accessibility_notes'
  | 'preferred_location_id'
  | 'equipment_required'
  | 'technical_support_notes'
  | 'registration_required'
> {
  const accessibility = normaliseAccessibility(input);
  const technicalSupportNotes = input.technicalSupportNotes?.trim() ?? '';
  return {
    // SCRUM-79 AC1
    room_layout: input.roomLayout ?? null,
    // SCRUM-79 AC2/AC3 — the answer itself, and the notes only when the answer is "yes".
    accessibility_required: accessibility.required,
    accessibility_notes: accessibility.notes,
    // SCRUM-79 AC4 — blank is "no preference", and NULL is how that is recorded.
    preferred_location_id: input.preferredLocationId ?? null,
    // SCRUM-80 AC3 — the equipment answer; its items are link rows (replaceEquipmentItems).
    equipment_required: normaliseEquipment(input).required,
    // SCRUM-80 AC2 — saved whatever the equipment answer is.
    technical_support_notes: technicalSupportNotes === '' ? null : technicalSupportNotes,
    // SCRUM-81 — written on every save, so unmarking a draft overwrites a
    // stored true (AC3); there is no separate "clear" step.
    registration_required: input.registrationRequired ?? null,
  };
}

/**
 * SCRUM-79 AC2 — the chosen features live in a link table, one row each. The
 * list is replaced whole on every save, so an answer of "none" (AC3) or a
 * cleared selection removes what was there before.
 *
 * supabase-js has no transactions: if this fails after the row was written,
 * the row stays (a draft is the organiser's work) and the error says why.
 * That can only happen for an id that is not on the maintained list, which the
 * form never offers.
 */
async function replaceAccessibilityFeatures(id: string, input: VenueRequirementsInput): Promise<void> {
  const supabase = createAdminClient();
  const { featureIds } = normaliseAccessibility(input);

  const deleted = await deleteEventRequestAccessibilityFeatures(supabase, id);
  if (deleted.error) {
    throw new ValidationError('The accessibility requirements could not be saved.', deleted.error.message);
  }
  const inserted = await insertEventRequestAccessibilityFeatures(supabase, id, featureIds);
  if (inserted.error) {
    throw new ValidationError('Each accessibility feature must be chosen from the list.', inserted.error.message);
  }
}

/**
 * SCRUM-80 AC1 — the equipment items, one row each in the order listed. Same
 * replace-whole-list rule and same no-transaction caveat as the accessibility
 * features above; a "none" answer (AC3) leaves no rows behind.
 */
async function replaceEquipmentItems(id: string, input: VenueRequirementsInput): Promise<void> {
  const supabase = createAdminClient();
  const { items } = normaliseEquipment(input);

  const deleted = await deleteEventRequestEquipment(supabase, id);
  if (deleted.error) {
    throw new ValidationError('The equipment requirements could not be saved.', deleted.error.message);
  }
  const inserted = await insertEventRequestEquipment(supabase, id, items);
  if (inserted.error) {
    throw new ValidationError('The equipment requirements could not be saved.', inserted.error.message);
  }
}

/** Every list that hangs off the request row, written after the row itself. */
async function replaceRequirementLists(id: string, input: VenueRequirementsInput): Promise<void> {
  await replaceAccessibilityFeatures(id, input);
  await replaceEquipmentItems(id, input);
}

function toWrite(input: EventRequestSaveInput): EventRequestWrite {
  return {
    name: input.name,
    purpose: input.purpose,
    description: input.description,
    // Stored as a calendar date, not an instant.
    proposed_date: input.proposedDate.toISOString().slice(0, 10),
    // SCRUM-238 — the times replace the slots (see EventRequestWrite).
    time_slots: null,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    // SCRUM-78. Was previously dropped on the create path entirely - the
    // draft path (toDraftWrite, SCRUM-83) already wrote this correctly.
    expected_attendance: input.expectedAttendance ?? null,
    ...toVenueRequirementsWrite(input),
  };
}

/**
 * AC1 — an Event Organiser always acts for their own client organisation. It is
 * read from the actor, never from the browser, so a request cannot be filed
 * against somebody else's organisation.
 *
 * Interim: the organisation may be null until the Client Organisations story
 * lands (see lib/auth/currentActor.ts). Creating without one is allowed for
 * now rather than blocking every organiser; the story that adds organisations
 * should make this throw again.
 */
function requireOrganiser(actor: Actor): { id: string; name: string } | null {
  if (!hasRole(actor.roles, 'event_organiser')) {
    throw new ForbiddenError('Only an Event Organiser can create an event request.');
  }
  return actor.clientOrganisation;
}

async function fetchOwnableRequest(id: string): Promise<EventRequest> {
  // The id arrives from a URL. Postgres raises 22P02 on a malformed uuid, which
  // would surface as a 500 for what is really just a bad link.
  if (!UUID_PATTERN.test(id)) throw new NotFoundError('Event request');

  const { data, error } = await fetchEventRequest(createAdminClient(), id);
  if (error) throw new ValidationError('The event request could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');

  return toEventRequest(data as unknown as EventRequestRow);
}

async function requireOwnRequest(actor: Actor, id: string): Promise<EventRequest> {
  const request = await fetchOwnableRequest(id);
  // SCRUM-83 AC3 — the rule itself lives in policy.ts so it can be tested
  // without a database; this is where it is applied.
  if (!isOwnRequest(request, actor.userId)) {
    throw new ForbiddenError('This event request belongs to another organiser.');
  }
  return request;
}

/**
 * SCRUM-204 AC3 — the read-only counterpart to requireOwnRequest(): also
 * lets a colleague in the same client organisation open a request once it
 * has left draft (canViewRequest in policy.ts). Editing, resubmitting, and
 * resuming a draft stay gated behind requireOwnRequest/canEditRequest — this
 * is for display only.
 */
async function requireViewableRequest(actor: Actor, id: string): Promise<EventRequest> {
  const request = await fetchOwnableRequest(id);
  const viewerOrganisation = { userId: actor.userId, clientOrganisationId: actor.clientOrganisation?.id ?? null };
  if (!canViewRequest(request, viewerOrganisation)) {
    throw new ForbiddenError('This event request belongs to another organisation.');
  }
  return request;
}

function parseSaveInput(input: unknown): EventRequestSaveInput {
  const parsed = eventRequestSaveSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The event request is not valid.', parsed.error.flatten());
  }
  return parsed.data;
}

/** AC1 — the blank form needs the organiser's own organisation to pre-fill. */
export async function getNewEventRequestContext(): Promise<{
  organiserName: string;
  clientOrganisation: { id: string; name: string } | null;
}> {
  const actor = await getCurrentActor();
  return { organiserName: actor.fullName, clientOrganisation: requireOrganiser(actor) };
}

/**
 * AC2 — saving stores the request; the database hands it a unique reference.
 * AC3 — all four fields are required, but the date's value is never checked
 * on save. That is what keeps a request with a date still to be fixed savable.
 */
export async function createEventRequest(input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const clientOrganisation = requireOrganiser(actor);
  const parsed = parseSaveInput(input);

  const { data, error } = await insertEventRequest(createAdminClient(), {
    ...toWrite(parsed),
    organiser_id: actor.userId,
    client_organisation_id: clientOrganisation?.id ?? null,
  });

  if (error || !data) {
    throw new ValidationError('The event request could not be saved.', error?.message);
  }
  // SCRUM-79/80 — the list rows, then a re-read so the result carries them.
  const { id } = data as unknown as EventRequestRow;
  await replaceRequirementLists(id, parsed);
  return requireOwnRequest(actor, id);
}

export async function updateEventRequestDetails(id: string, input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);
  const existing = await requireOwnRequest(actor, id);

  // SCRUM-82 AC4 — a submitted request is read-only. The page hides the edit
  // action; this is the same rule where it cannot be bypassed.
  if (!isEditable(existing.status)) {
    throw new InvalidTransitionError(existing.status, 'draft');
  }

  const parsed = parseSaveInput(input);
  const { data, error } = await updateEventRequest(createAdminClient(), id, toWrite(parsed));
  if (error || !data) {
    throw new ValidationError('The event request could not be updated.', error?.message);
  }
  await replaceRequirementLists(id, parsed);
  return requireOwnRequest(actor, id);
}

export async function getEventRequest(id: string): Promise<EventRequest> {
  return requireViewableRequest(await getCurrentActor(), id);
}

// ---------------------------------------------------------------------------
// SCRUM-83 — Save an incomplete request as a draft
// SCRUM-85 — Resume editing a draft
// ---------------------------------------------------------------------------

function parseDraftInput(input: unknown): EventRequestDraftInput {
  const parsed = eventRequestDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The draft could not be saved.', parsed.error.flatten());
  }
  return parsed.data;
}

/**
 * A draft writes every field it was given and nulls the rest. Null, not
 * "leave alone": re-saving a draft after clearing a field has to clear it in
 * the row too, or the form and the record would disagree (SCRUM-85 AC3 shows
 * the organiser exactly what is stored).
 */
function toDraftWrite(input: EventRequestDraftInput): EventRequestWrite {
  return {
    name: input.name,
    purpose: input.purpose ?? null,
    description: input.description ?? null,
    proposed_date: input.proposedDate ? input.proposedDate.toISOString().slice(0, 10) : null,
    // SCRUM-238 — as in toWrite(): times, never slots.
    time_slots: null,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    expected_attendance: input.expectedAttendance ?? null,
    ...toVenueRequirementsWrite(input),
  };
}

/**
 * SCRUM-83 AC1 — saves whatever has been filled in. No mandatory-field check
 * runs here: that is the whole point of the action, and it is what separates
 * this from createEventRequest() above. The row lands as draft because the
 * column defaults to it.
 */
export async function saveEventRequestDraft(input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const clientOrganisation = requireOrganiser(actor);
  const parsed = parseDraftInput(input);

  const { data, error } = await insertEventRequest(createAdminClient(), {
    ...toDraftWrite(parsed),
    organiser_id: actor.userId,
    client_organisation_id: clientOrganisation?.id ?? null,
  });

  if (error || !data) {
    throw new ValidationError('The draft could not be saved.', error?.message);
  }
  // SCRUM-79/80 — a draft keeps its accessibility features and equipment too.
  const { id } = data as unknown as EventRequestRow;
  await replaceRequirementLists(id, parsed);
  return requireOwnRequest(actor, id);
}

/**
 * SCRUM-83 AC4 — saving again while editing a draft updates that same draft.
 * An UPDATE on the id, never an insert, so no second draft can appear.
 *
 * SCRUM-85 AC3 — this is also the save behind resumed editing.
 */
export async function updateEventRequestDraft(id: string, input: unknown): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const existing = await requireOwnRequest(actor, id);
  // A submitted request is read-only (SCRUM-82 AC4). Enforced here, not only
  // by hiding the form, so a direct API call cannot get around it.
  if (!isResumable(existing.status)) {
    throw new InvalidTransitionError(existing.status, 'draft');
  }

  const parsed = parseDraftInput(input);
  const { data, error } = await updateEventRequest(createAdminClient(), id, toDraftWrite(parsed));
  if (error || !data) {
    throw new ValidationError('The draft could not be saved.', error?.message);
  }
  await replaceRequirementLists(id, parsed);
  return requireOwnRequest(actor, id);
}

/**
 * SCRUM-85 AC3 — reopen a draft for editing, with everything previously
 * entered still on it. Refuses anything that is no longer a draft, so the
 * edit page cannot be reached for a submitted request by typing its URL.
 */
export async function getEventRequestDraftForEditing(id: string): Promise<EventRequest> {
  const actor = await getCurrentActor();
  const request = await requireOwnRequest(actor, id);

  if (!isResumable(request.status)) {
    throw new InvalidTransitionError(request.status, 'draft');
  }
  return request;
}

// ---------------------------------------------------------------------------
// SCRUM-82 — Submit a completed event request
// ---------------------------------------------------------------------------

/**
 * AC1 — a complete draft becomes submitted, with the submission time stamped
 * by the database. It is in the assignment queue from that moment, because
 * the queue is defined as "every submitted request" (see
 * listSubmittedEventRequests in src/lib/supabase/eventRequests.ts).
 *
 * AC2 — an incomplete draft is refused with every incomplete field named, and
 * nothing about it changes, so it stays editable.
 */
export async function submitEventRequest(id: string): Promise<EventRequest> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const existing = await requireOwnRequest(actor, id);
  if (!canBeSubmitted(existing.status)) {
    throw new InvalidTransitionError(existing.status, 'submitted');
  }

  // `now` enables the same-day start-time check (SCRUM-238 AC5) alongside the
  // date-only rules; incompleteFields() defaults `today` itself when omitted.
  const incomplete = incompleteFields(existing, undefined, new Date());
  if (incomplete.length > 0) {
    throw new ValidationError(
      'The request cannot be submitted until every mandatory field is complete.',
      { incompleteFields: incomplete },
    );
  }

  const { data, error } = await markEventRequestSubmitted(createAdminClient(), id);
  if (error) {
    throw new ValidationError('The event request could not be submitted.', error.message);
  }
  // No row matched: another call submitted it first (see the `status` filter).
  if (!data) throw new InvalidTransitionError('submitted', 'submitted');
  return toEventRequest(data as unknown as EventRequestRow);
}

// ---------------------------------------------------------------------------
// SCRUM-79 — State venue and accessibility requirements
// ---------------------------------------------------------------------------

export interface VenueRequirementOptions {
  /** AC2 — the maintained accessibility list (SCRUM-117) the organiser picks from. */
  accessibilityFeatures: ReferenceRow[];
  /** AC4 — the maintained location list (SCRUM-116) a preference is chosen from. */
  locations: ReferenceRow[];
}

/** What the request form needs to offer the venue-requirement choices. */
export async function getVenueRequirementOptions(): Promise<VenueRequirementOptions> {
  const [accessibilityFeatures, locations] = await Promise.all([
    fetchAccessibilityFeatures(),
    fetchLocations(),
  ]);
  const firstError = accessibilityFeatures.error ?? locations.error;
  if (firstError) {
    throw new ValidationError('The venue requirement options could not be read.', firstError.message);
  }
  return {
    accessibilityFeatures: accessibilityFeatures.data ?? [],
    locations: locations.data ?? [],
  };
}

/**
 * AC3 — the organiser's own event list: reference, status and submission date.
 *
 * SCRUM-204 AC3 — plus every non-draft request from a colleague in the same
 * client organisation, view-only (canViewRequest/canEditRequest in
 * policy.ts). Unlinked organisers (no clientOrganisation, AC2) only ever see
 * their own, since the query has no organisation to widen against.
 */
export async function listMyEventRequests(): Promise<EventRequest[]> {
  const actor = await getCurrentActor();
  requireOrganiser(actor);

  const { data, error } = await listEventRequestsForOrganiser(
    createAdminClient(),
    actor.userId,
    actor.clientOrganisation?.id ?? null,
  );
  if (error) throw new ValidationError('Your event requests could not be read.', error.message);
  return (data ?? []).map((row) => toEventRequest(row as unknown as EventRequestRow));
}