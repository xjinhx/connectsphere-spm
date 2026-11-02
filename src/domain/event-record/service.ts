import { NO_ACCESS_MESSAGE, canSeeCoordinatorContact, eventRecordViewers, sectionsVisibleTo } from './policy';
import type { EventRecord } from './schema';
import { getCoordinatorView } from '@/domain/assignment/service';
import { readEquipmentArrangement } from '@/domain/equipment-request/service';
import { essentialArrangementProgress } from '@/domain/essential-arrangements/policy';
import { toEventRequest } from '@/domain/event-request/service';
import { EventRequestIdSchema } from '@/domain/event-status/schema';
import { readEssentialArrangementState } from '@/domain/event-status/service';
import type { Role } from '@/domain/identity/roles';
import { ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import { listEventBookingRequests, listEventVenueBookings } from '@/domain/venue-booking/service';
import { fetchEventInformationRow, type EventInformationRow } from '@/lib/supabase/eventInformation';
import { fetchEventRequestById, type EventRequestRow } from '@/lib/supabase/eventRequests';
import { fetchProfileNames } from '@/lib/supabase/profiles';
import { fetchRegistrationSettingsRow, type RegistrationSettingsRow } from '@/lib/supabase/registrationList';

/**
 * SCRUM-109 — View the full event record.
 *
 * One read for one page: everything the viewer may see about the event, each
 * section read through the service of the story that owns it, and only once
 * the viewer is known to be allowed it (AC2). Read-only: nothing here, and
 * nothing on the page, changes the event (AC3).
 */

type Actor = { userId: string; roles: Role[]; clientOrganisation: { id: string } | null };

async function readEvent(eventRequestId: string): Promise<EventRequestRow> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const { data, error } = await fetchEventRequestById(eventRequestId);
  if (error) throw new ValidationError('The event could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventRequestRow;
}

async function readCoordinator(event: EventRequestRow, actor: Actor, withContact: boolean): Promise<EventRecord['coordinator']> {
  if (event.coordinator_id === null) return null;
  if (withContact) {
    const { current } = await getCoordinatorView(event.id, actor);
    return current ? { name: current.fullName, email: current.email, contactNumber: current.contactNumber } : null;
  }
  const { data } = await fetchProfileNames([event.coordinator_id]);
  const name = (data as { id: string; full_name: string | null }[] | null)?.[0]?.full_name ?? null;
  return { name, email: null, contactNumber: null };
}

async function readInternal(eventRequestId: string): Promise<NonNullable<EventRecord['internal']>> {
  const { data, error } = await fetchEventInformationRow(eventRequestId);
  if (error || !data) throw new ValidationError('The event information could not be read.', error?.message);
  const row = data as unknown as EventInformationRow;
  return {
    internalNotes: row.internal_notes,
    clientContactName: row.client_contact_name,
    clientContactEmail: row.client_contact_email,
    clientContactPhone: row.client_contact_phone,
  };
}

async function readRegistration(eventRequestId: string): Promise<RegistrationSettingsRow> {
  const { data, error } = await fetchRegistrationSettingsRow(eventRequestId);
  if (error || !data) throw new ValidationError("The event's registration setting could not be read.", error?.message);
  return data as unknown as RegistrationSettingsRow;
}

/**
 * AC1-AC3: the event's record as `actor` may see it. Refused with
 * ForbiddenError when they are not related to the event (eventRecordViewers),
 * before any section is read.
 *
 * The booking requests and equipment lines are read before the check, because
 * they are what relate Venue Staff and Technical Support Staff to an event
 * (#66); they leave this function only in a section the viewer may see.
 */
export async function getEventRecord(eventRequestId: string, actor: Actor): Promise<EventRecord> {
  const event = await readEvent(eventRequestId);
  const [requests, equipment] = await Promise.all([
    listEventBookingRequests(event.id),
    readEquipmentArrangement(event.id),
  ]);

  const viewers = eventRecordViewers(
    {
      organiserId: event.organiser_id,
      clientOrganisationId: event.client_organisation_id,
      coordinatorId: event.coordinator_id,
      status: event.status,
      hasBookingRequest: requests.length > 0,
      hasEquipmentRequest: equipment.lines.length > 0,
    },
    { userId: actor.userId, roles: actor.roles, clientOrganisationId: actor.clientOrganisation?.id ?? null },
  );
  if (viewers.length === 0) throw new ForbiddenError(NO_ACCESS_MESSAGE);
  const sections = new Set(sectionsVisibleTo(viewers));

  const record: EventRecord = {
    id: event.id,
    reference: event.reference,
    name: event.name,
    status: event.status,
    viewers,
    details: toEventRequest(event),
  };

  if (sections.has('coordinator')) {
    record.coordinator = await readCoordinator(event, actor, canSeeCoordinatorContact(viewers));
  }
  if (sections.has('internal')) record.internal = await readInternal(event.id);
  if (sections.has('venue')) {
    const bookings = await listEventVenueBookings(event.id, actor.userId);
    record.venue = {
      bookings: bookings.map(({ venueName, date, startTime, endTime, status }) => ({ venueName, date, startTime, endTime, status })),
      requests,
    };
  }
  if (sections.has('equipment')) {
    record.equipment = {
      status: equipment.status,
      lines: equipment.lines.map(({ equipmentName, quantity, reserved }) => ({ equipmentName, quantity, reserved })),
    };
  }

  if (sections.has('registration') || sections.has('essential')) {
    const settings = await readRegistration(event.id);
    const registration = {
      startDate: settings.registration_start_date,
      endDate: settings.registration_end_date,
      capacity: settings.registration_capacity,
    };
    if (sections.has('registration')) record.registration = { required: event.registration_required, ...registration };
    if (sections.has('essential')) {
      const { snapshot, flagged } = await readEssentialArrangementState(event.id, actor.userId);
      record.essential = essentialArrangementProgress(snapshot, flagged, registration);
    }
  }

  return record;
}
