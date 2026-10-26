import { createAdminClient } from './admin';
import type { EventRequestStatus } from '@/domain/event-request/schema';

/**
 * SCRUM-111 — Supabase access for an event's significant change and the
 * review-required flag on its arrangements. Thin by design: who may change or
 * re-confirm what is decided in src/domain/significant-change/service.ts.
 */

const db = () => createAdminClient();

const SCHEDULE_COLUMNS =
  'id, status, coordinator_id, updated_at, proposed_date, start_time, end_time, expected_attendance, room_layout, accessibility_required, accessibility_notes';

export interface EventScheduleRow {
  id: string;
  status: EventRequestStatus;
  coordinator_id: string | null;
  updated_at: string;
  proposed_date: string | null;
  start_time: string | null;
  end_time: string | null;
  expected_attendance: number | null;
  room_layout: string | null;
  accessibility_required: boolean | null;
  accessibility_notes: string | null;
}

const REVIEW_COLUMNS = 'review_required, review_required_at, review_required_cause, reconfirmed_by, reconfirmed_at';

export interface ReviewColumns {
  review_required: boolean;
  review_required_at: string | null;
  review_required_cause: string | null;
  reconfirmed_by: string | null;
  reconfirmed_at: string | null;
}

export interface BookingArrangementRow extends ReviewColumns {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  venue: { name: string } | null;
}

export interface ReservationArrangementRow extends ReviewColumns {
  id: string;
  quantity: number;
  window_start: string;
  window_end: string;
  equipment: { name: string } | null;
}

export async function fetchEventScheduleRow(eventRequestId: string) {
  return db().from('event_request').select(SCHEDULE_COLUMNS).eq('id', eventRequestId).maybeSingle();
}

/** The event's confirmed venue bookings: a released one is no longer an arrangement. */
export async function fetchConfirmedBookingArrangements(eventRequestId: string) {
  return db()
    .from('venue_booking')
    .select(`id, date, start_time, end_time, ${REVIEW_COLUMNS}, venue:venue_id (name)`)
    .eq('event_request_id', eventRequestId)
    .eq('status', 'confirmed')
    .order('date')
    .order('start_time');
}

/** The event's reserved equipment: a released reservation is no longer an arrangement. */
export async function fetchReservedEquipmentArrangements(eventRequestId: string) {
  return db()
    .from('equipment_reservation')
    .select(`id, quantity, window_start, window_end, ${REVIEW_COLUMNS}, equipment ( name )`)
    .eq('event_request_id', eventRequestId)
    .eq('status', 'reserved')
    .order('created_at')
    .order('id');
}

/** AC9: who re-confirmed, by name. */
export async function fetchProfileNames(accountIds: readonly string[]) {
  return db().from('profiles').select('id, full_name').in('id', [...accountIds]);
}

/**
 * AC1, AC2, AC4, AC5: one call to change_event_schedule, which saves the
 * change and flags every affected arrangement in one transaction, or refuses
 * it without the acknowledgement. Resolves to {"outcome": ...}; see the
 * migration 20261025183932_review_required_flag.sql for each outcome.
 */
export async function changeEventScheduleRow(params: {
  eventRequestId: string;
  coordinatorId: string;
  expectedUpdatedAt: string;
  proposedDate: string;
  startTime: string;
  endTime: string;
  expectedAttendance: number;
  roomLayout: string | null;
  accessibilityRequired: boolean | null;
  accessibilityNotes: string | null;
  bookingCause: string | null;
  reservationCause: string | null;
  acknowledged: boolean;
}) {
  // The generated Args type marks every parameter non-null; null is how the
  // function is told "not provided" and "this kind is not affected".
  return db().rpc('change_event_schedule', {
    p_event_request_id: params.eventRequestId,
    p_coordinator_id: params.coordinatorId,
    p_expected_updated_at: params.expectedUpdatedAt,
    p_proposed_date: params.proposedDate,
    p_start_time: params.startTime,
    p_end_time: params.endTime,
    p_expected_attendance: params.expectedAttendance,
    p_room_layout: params.roomLayout as string,
    p_accessibility_required: params.accessibilityRequired as boolean,
    p_accessibility_notes: params.accessibilityNotes as string,
    p_booking_cause: params.bookingCause as string,
    p_reservation_cause: params.reservationCause as string,
    p_acknowledged: params.acknowledged,
  });
}

const TABLES = { venue_booking: 'venue_booking', equipment_reservation: 'equipment_reservation' } as const;

/** The arrangement's event and whether it is flagged, to check who may re-confirm it. */
export async function fetchArrangementForReconfirm(kind: keyof typeof TABLES, id: string) {
  return db().from(TABLES[kind]).select('id, event_request_id, status, review_required').eq('id', id).maybeSingle();
}

/**
 * AC9: clears the flag and records who and when. Guarded in the same
 * statement on the flag still being set, so two re-confirmations at once
 * record the first only (data is null for the second).
 */
export async function reconfirmArrangementRow(kind: keyof typeof TABLES, id: string, reconfirmedBy: string) {
  return db()
    .from(TABLES[kind])
    .update({ review_required: false, reconfirmed_by: reconfirmedBy, reconfirmed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('review_required', true)
    .select('id')
    .maybeSingle();
}
