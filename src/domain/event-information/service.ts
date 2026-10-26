import { EventInformationInputSchema, type EventInformationInput, type EventInformationView } from './schema';
import { NOT_ASSIGNED_MESSAGE, canEditEventInformation, finishedEventNotice, isFinishedEvent } from './policy';
import { EventRequestIdSchema } from '@/domain/event-status/schema';
import { isCurrentCoordinator } from '@/domain/assignment/policy';
import { hasRole } from '@/domain/identity/policy';
import type { Role } from '@/domain/identity/roles';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@/domain/shared/errors';
import {
  fetchEventInformationRow,
  updateEventInformationRow,
  type EventInformationRow,
} from '@/lib/supabase/eventInformation';

/**
 * SCRUM-110 — Edit ordinary event information.
 *
 * AC1: the assigned coordinator of an event that is not Cancelled or Completed
 * edits its description, internal notes and client contact, and nothing else
 * happens: no arrangement is flagged, nobody is notified. AC5: a finished
 * event refuses the edit. AC2-AC4 are the organiser side, which never reaches
 * this service: the organiser's routes refuse a submitted request already
 * (SCRUM-82 AC4, SCRUM-204), and the role check on this story's route keeps
 * organisers out of it entirely.
 */

async function readEvent(eventRequestId: string): Promise<EventInformationRow> {
  if (!EventRequestIdSchema.safeParse(eventRequestId).success) throw new NotFoundError('Event request');
  const { data, error } = await fetchEventInformationRow(eventRequestId);
  if (error) throw new ValidationError('The event could not be read.', error.message);
  if (!data) throw new NotFoundError('Event request');
  return data as unknown as EventInformationRow;
}

function toInput(row: EventInformationRow): EventInformationInput {
  return {
    description: row.description ?? '',
    internalNotes: row.internal_notes,
    clientContactName: row.client_contact_name,
    clientContactEmail: row.client_contact_email,
    clientContactPhone: row.client_contact_phone,
  };
}

/**
 * For the coordinator's event page. Internal notes are internal: only the
 * event's assigned coordinator and the Event Coordinator Lead (who may open
 * the same page read-only, SCRUM-232 AC5) are given them.
 */
export async function getEventInformation(
  eventRequestId: string,
  actor: { userId: string; roles: Role[] },
): Promise<EventInformationView> {
  const event = await readEvent(eventRequestId);
  const assigned = isCurrentCoordinator(event.coordinator_id, actor.userId);
  if (!assigned && !hasRole(actor.roles, 'operations_manager')) {
    throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
  }
  const view = { status: event.status, coordinatorId: event.coordinator_id };
  return {
    ...toInput(event),
    canEdit: canEditEventInformation(view, actor.userId),
    readOnlyReason: isFinishedEvent(event.status) ? finishedEventNotice(event.status) : null,
  };
}

/**
 * AC1: store the five fields; AC5: refused on a Completed or Cancelled event.
 *
 * Checked in the same order as recordEssentialArrangements (SCRUM-100): the
 * coordinator first, so someone the event is not assigned to learns nothing
 * more about it, then the input, then the status. The write repeats the
 * coordinator and status conditions, so a reassignment or a cancellation
 * between this read and the write is still refused.
 *
 * `actorId` is whoever is signed in, from the route, never from the body.
 */
export async function updateEventInformation(
  eventRequestId: string,
  actorId: string,
  input: unknown,
): Promise<EventInformationInput> {
  const event = await readEvent(eventRequestId);

  if (!isCurrentCoordinator(event.coordinator_id, actorId)) {
    throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
  }

  const parsed = EventInformationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'The event information is not valid.',
      parsed.error.flatten(),
    );
  }

  if (isFinishedEvent(event.status)) throw new ConflictError(finishedEventNotice(event.status));

  const values = parsed.data;
  const { data, error } = await updateEventInformationRow(eventRequestId, actorId, {
    description: values.description,
    internal_notes: values.internalNotes,
    client_contact_name: values.clientContactName,
    client_contact_email: values.clientContactEmail,
    client_contact_phone: values.clientContactPhone,
  });
  if (error) throw new ValidationError('The event information could not be saved.', error.message);

  if (!data) {
    // The event changed after it was read above: say which way.
    const now = await readEvent(eventRequestId);
    if (!isCurrentCoordinator(now.coordinator_id, actorId)) throw new ForbiddenError(NOT_ASSIGNED_MESSAGE);
    throw new ConflictError(finishedEventNotice(now.status));
  }
  return toInput(data as unknown as EventInformationRow);
}
