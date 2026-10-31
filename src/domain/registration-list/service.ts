import {
  RegistrationSettingsInputSchema,
  type RegistrationListEntry,
  type RegistrationListView,
  type RegistrationSettingsInput,
  type RegistrationSettingsView,
} from './schema';
import {
  EXPORT_NOT_ALLOWED_MESSAGE,
  NO_ACCESS_MESSAGE,
  NO_CONFIRMED_VENUE_MESSAGE,
  NOT_ASSIGNED_MESSAGE,
  acceptsRegistrationSettings,
  canEditRegistrationSettings,
  canExportRegistrationList,
  capacityOverVenueMessage,
  exportFileName,
  largestVenueCapacity,
  notConfirmedNotice,
  placesRemaining,
  registeredCount,
  registrationListCsv,
  registrationListViewer,
} from './policy';
import { RegistrationStatusSchema } from '@/domain/event-registration/schema';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import { EventRequestIdSchema } from '@/domain/event-status/schema';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { hasRole } from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import {
  fetchConfirmedVenueCapacities,
  fetchEventRegistrations,
  fetchRegistrationListEvent,
  fetchRegistrationSettingsRow,
  updateRegistrationSettingsRow,
  type RegistrationSettingsRow,
} from '@/lib/supabase/registrationList';

/**
 * SCRUM-185 — View the registration list for an event.
 *
 * AC5: the assigned coordinator of a Confirmed event sets the registration
 * start date, end date and capacity, and the registration page shows them.
 * AC6: an end date before the start date, or a capacity above the largest of
 * the event's venue capacities, is refused with a message naming the field.
 *
 * Saving the period replaces SCRUM-181's dummy D-22 (the seed script setting
 * it): 181 reads the same two columns to open and close registration.
 */

async function readEvent(eventRequestId: string): Promise<RegistrationSettingsRow> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const { data, error } = await fetchRegistrationSettingsRow(eventRequestId);
  if (error) throw new ValidationError('The event could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as RegistrationSettingsRow;
}

async function readLargestVenueCapacity(eventRequestId: string): Promise<number | null> {
  const { data, error } = await fetchConfirmedVenueCapacities(eventRequestId);
  if (error) throw new ValidationError("The event's venues could not be read.", error.message);
  const rows = (data ?? []) as unknown as { venue: { max_capacity: number } | null }[];
  return largestVenueCapacity(rows.flatMap((row) => (row.venue ? [row.venue.max_capacity] : [])));
}

/** A single-field error in the same shape as a Zod flatten(), so the form can mark the field. */
function fieldError(field: keyof RegistrationSettingsInput, message: string): ValidationError {
  return new ValidationError(message, { formErrors: [], fieldErrors: { [field]: [message] } });
}

/**
 * For the registration page. The assigned coordinator, and the Event
 * Coordinator Lead read-only (as on the coordinator's event page, SCRUM-232
 * AC5). The organiser's access (AC2-AC4) is the registration list's.
 */
export async function getRegistrationSettings(
  eventRequestId: string,
  actor: { userId: string; roles: Role[] },
): Promise<RegistrationSettingsView> {
  const event = await readEvent(eventRequestId);
  const assigned = isCurrentCoordinator(event.coordinator_id, actor.userId);
  if (!assigned && !hasRole(actor.roles, 'operations_manager')) {
    throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
  }
  return {
    eventRequestId: event.id,
    eventName: event.name,
    eventReference: event.reference,
    startDate: event.registration_start_date,
    endDate: event.registration_end_date,
    capacity: event.registration_capacity,
    largestVenueCapacity: await readLargestVenueCapacity(event.id),
    canEdit: canEditRegistrationSettings({ status: event.status, coordinatorId: event.coordinator_id }, actor.userId),
    readOnlyReason: acceptsRegistrationSettings(event.status) ? null : notConfirmedNotice(event.status),
  };
}

/**
 * AC5: store the start date, end date and capacity together. AC6: refuse an
 * end date before the start date (the schema) or a capacity above the largest
 * of the event's venue capacities (here), naming the field.
 *
 * Checked in the same order as updateEventInformation (SCRUM-110): the
 * coordinator first, so someone the event is not assigned to learns nothing
 * more about it, then the status, then the input. The write repeats the
 * coordinator and status conditions.
 *
 * `actorId` is whoever is signed in, from the route, never from the body.
 */
export async function updateRegistrationSettings(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<RegistrationSettingsInput> {
  const event = await readEvent(eventRequestId);

  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
  }
  if (!acceptsRegistrationSettings(event.status)) throw new ConflictError(notConfirmedNotice(event.status));

  const parsed = RegistrationSettingsInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The registration settings are not valid.',
      parsed.error.flatten(),
    );
  }
  const values = parsed.data;

  const limit = await readLargestVenueCapacity(event.id);
  if (limit === null) throw fieldError('capacity', NO_CONFIRMED_VENUE_MESSAGE);
  if (values.capacity > limit) throw fieldError('capacity', capacityOverVenueMessage(limit));

  const { data, error } = await updateRegistrationSettingsRow(eventRequestId, actorId, {
    registration_start_date: values.startDate,
    registration_end_date: values.endDate,
    registration_capacity: values.capacity,
  });
  if (error) throw new ValidationError('The registration settings could not be saved.', error.message);

  if (!data) {
    // The event changed after it was read above: say which way.
    const now = await readEvent(eventRequestId);
    if (!isCurrentCoordinator(now.coordinator_id, actorId)) throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
    throw new ConflictError(notConfirmedNotice(now.status));
  }
  const row = data as unknown as RegistrationSettingsRow;
  return {
    startDate: row.registration_start_date ?? values.startDate,
    endDate: row.registration_end_date ?? values.endDate,
    capacity: row.registration_capacity ?? values.capacity,
  };
}

// ---------------------------------------------------------------------------
// AC1-AC4 — the registration list
// ---------------------------------------------------------------------------

type ListEventRow = {
  id: string;
  name: string;
  reference: string;
  status: EventRequestStatus;
  coordinator_id: string | null;
  organiser_id: string;
  client_organisation_id: string | null;
  registration_capacity: number | null;
};

type RegistrationRow = {
  id: string;
  reference: string;
  event_request_id: string;
  full_name: string;
  email: string;
  contact_number: string;
  status: string;
  registered_at: string;
};

type ListActor = { userId: string; roles: Role[]; clientOrganisation: { id: string } | null };

/**
 * The event and who the actor is to it. AC4: anyone the list isn't for is
 * refused before anything about the registrations is read.
 */
async function readListEvent(eventRequestId: string, actor: ListActor) {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const { data, error } = await fetchRegistrationListEvent(eventRequestId);
  if (error) throw new ValidationError('The event could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  const event = data as unknown as ListEventRow;
  const viewer = registrationListViewer(
    {
      status: event.status,
      coordinatorId: event.coordinator_id,
      organiserId: event.organiser_id,
      clientOrganisationId: event.client_organisation_id,
    },
    { userId: actor.userId, roles: actor.roles, clientOrganisationId: actor.clientOrganisation?.id ?? null },
  );
  if (!viewer) throw new ForbiddenError(NO_ACCESS_MESSAGE);
  return { event, viewer };
}

async function readRegistrations(eventRequestId: string): Promise<RegistrationListEntry[]> {
  const { data, error } = await fetchEventRegistrations(eventRequestId);
  if (error) throw new ValidationError('The registrations could not be read.', error.message);
  return ((data ?? []) as unknown as RegistrationRow[]).map((row) => ({
    id: row.id,
    reference: row.reference,
    eventRequestId: row.event_request_id,
    fullName: row.full_name,
    email: row.email,
    contactNumber: row.contact_number,
    status: RegistrationStatusSchema.parse(row.status),
    registeredAt: row.registered_at,
  }));
}

/**
 * AC1-AC4: the registration page's list. Every registration with its date and
 * status, the number registered (Registered rows only), the capacity and the
 * places remaining. AC2/AC3 decide whether Export is offered; AC4 refuses
 * anyone else with ForbiddenError.
 *
 * `actor` is whoever is signed in, from the session, never from the request.
 */
export async function getRegistrationList(eventRequestId: string, actor: ListActor): Promise<RegistrationListView> {
  const { event, viewer } = await readListEvent(eventRequestId, actor);
  const registrations = await readRegistrations(event.id);
  const registered = registeredCount(registrations);
  return {
    eventRequestId: event.id,
    eventName: event.name,
    eventReference: event.reference,
    eventStatus: event.status,
    viewer,
    registrations,
    registered,
    capacity: event.registration_capacity,
    placesRemaining: placesRemaining(event.registration_capacity, registered),
    canExport: canExportRegistrationList(viewer),
  };
}

/**
 * AC2: the attendee information as a CSV file, for the organiser responsible
 * for the event. AC3: a colleague in the same organisation is refused, even
 * though they may view the list; AC4: anyone else is refused as for the list.
 */
export async function exportRegistrationList(
  eventRequestId: string,
  actor: ListActor,
): Promise<{ fileName: string; csv: string }> {
  const { event, viewer } = await readListEvent(eventRequestId, actor);
  if (!canExportRegistrationList(viewer)) throw new ForbiddenError(EXPORT_NOT_ALLOWED_MESSAGE);
  return { fileName: exportFileName(event.reference), csv: registrationListCsv(await readRegistrations(event.id)) };
}
