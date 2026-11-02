-- =============================================================================
-- SCRUM-105 — Cancel an event at any stage
-- =============================================================================
-- AC1: the assigned coordinator cancels an event in any status with a reason;
--      the status becomes Cancelled and the reason, who and when are recorded.
-- AC3: every confirmed venue booking and every reserved equipment reservation
--      is released, so their times and quantities return to availability.
-- AC4: the organiser, the staff who actioned each arrangement and every
--      attendee with an active registration are told (the service, from what
--      cancel_event returns).
-- AC5: a released booking is no longer confirmed, so search, the calendar and
--      getVenueCommitments already leave it out (as SCRUM-231's release does).
-- AC6: each released booking records its cause "Event cancelled", the
--      cancelling coordinator and the time (the release_* columns SCRUM-231
--      added), and Venue Staff are told the times are free (the service).
--
-- Readings used (to be agreed by the PO, see the SCRUM-105 test tab):
--   "any status" is Submitted to Preparation, as event-status/policy.ts allows;
--   Draft has no coordinator, and Rejected, Completed and Cancelled are final.
--   A Pending booking line is rejected with "Event cancelled", so Venue Staff
--   cannot approve it later. Active holds are left to expire.
--
-- Who may cancel (the event's assigned coordinator, never the Lead: AC2) is
-- checked in src/domain/event-status/service.ts before cancel_event is called.
-- Everything here happens in one transaction: the event is never Cancelled
-- with its arrangements still held, or the other way round.
-- =============================================================================

alter table event_request
  add column cancellation_reason text,
  -- Restrict, as completed_by: deleting an account must not erase who
  -- cancelled what.
  add column cancelled_by uuid references auth.users (id) on delete restrict,
  add column cancelled_at timestamptz,
  -- Recorded on a cancelled event only. An event cancelled through the app
  -- always has all three; one moved to Cancelled before this story (by a
  -- script or a test) may have none.
  add constraint event_request_cancellation_recorded check (
    (status = 'cancelled' or (cancellation_reason is null and cancelled_by is null and cancelled_at is null))
    and (
      (cancellation_reason is null and cancelled_by is null and cancelled_at is null)
      or (cancellation_reason is not null and length(trim(cancellation_reason)) > 0
          and cancelled_by is not null and cancelled_at is not null)
    )
  );

-- AC4, AC6: the notification type. Keeps every type already allowed
-- (20261028090100_notifications_change_requested.sql); any later widening must
-- keep these too.
alter table notifications
  drop constraint notifications_type_known;

alter table notifications
  add constraint notifications_type_known check (type in (
    'clarification_requested',
    'request_approved',
    'request_rejected',
    'coordinator_assigned',
    'coordinator_named',
    'venue_booking_update',
    'request_submitted',
    'coordinator_unassigned',
    'equipment_unable_to_fulfil',
    'event_confirmed',
    'change_requested',
    'event_cancelled'
  ));

-- -----------------------------------------------------------------------------
-- Cancelling
-- -----------------------------------------------------------------------------
-- Locks the event first, so a second click, another tab, a confirmation or the
-- completion check running at the same moment takes its turn.
--
-- Returns { outcome: 'not_found' } or { outcome: 'not_cancellable', status }
-- changing nothing, or { outcome: 'cancelled', organiser_id, bookings,
-- reservations, attendee_ids } listing what was released and who to tell:
--   bookings:     venue, date, times and the Venue Staff who approved it
--   reservations: equipment, quantity and who reserved it
-- -----------------------------------------------------------------------------
create function cancel_event(p_event_request_id uuid, p_reason text, p_cancelled_by uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status event_request_status;
  v_organiser uuid;
  v_now timestamptz := now();
  v_bookings jsonb;
  v_reservations jsonb;
  v_attendees jsonb;
begin
  select status, organiser_id into v_status, v_organiser
    from event_request where id = p_event_request_id for update;

  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_status not in ('submitted', 'clarification_requested', 'approved', 'planning', 'confirmed', 'preparation') then
    return jsonb_build_object('outcome', 'not_cancellable', 'status', v_status);
  end if;

  -- AC1
  update event_request
     set status = 'cancelled',
         cancellation_reason = p_reason,
         cancelled_by = p_cancelled_by,
         cancelled_at = v_now
   where id = p_event_request_id;

  -- AC3, AC6: every confirmed booking, released with its cause, who and when.
  with released as (
    update venue_booking
       set status = 'released',
           release_reason = 'Event cancelled',
           released_by = p_cancelled_by,
           released_at = v_now
     where event_request_id = p_event_request_id
       and status = 'confirmed'
    returning venue_id, date, start_time, end_time, request_line_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_name', v.name,
           'date', r.date,
           'start_time', r.start_time,
           'end_time', r.end_time,
           'approved_by', l.decided_by
         ) order by r.date, r.start_time, v.name), '[]'::jsonb)
    into v_bookings
    from released r
    join venues v on v.id = r.venue_id
    left join venue_booking_request_line l on l.id = r.request_line_id;

  -- AC3: every reserved quantity, released the same way (SCRUM-177's columns).
  with released as (
    update equipment_reservation
       set status = 'released',
           release_reason = 'Event cancelled',
           released_by = p_cancelled_by,
           released_at = v_now,
           updated_at = v_now
     where event_request_id = p_event_request_id
       and status = 'reserved'
    returning equipment_id, quantity, reserved_by
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'equipment_name', e.name,
           'quantity', r.quantity,
           'reserved_by', r.reserved_by
         ) order by e.name), '[]'::jsonb)
    into v_reservations
    from released r
    join equipment e on e.id = r.equipment_id;

  -- Read as part of AC3: a line still waiting for Venue Staff is rejected, so
  -- it leaves their queue and can never be approved for a cancelled event.
  update venue_booking_request_line l
     set status = 'rejected',
         rejection_reason = 'Event cancelled',
         decided_by = p_cancelled_by,
         decided_at = v_now
    from venue_booking_request r
   where l.request_id = r.id
     and r.event_request_id = p_event_request_id
     and l.status = 'pending';

  -- AC4: every attendee with an active registration.
  select coalesce(jsonb_agg(distinct attendee_id), '[]'::jsonb)
    into v_attendees
    from event_registration
   where event_request_id = p_event_request_id
     and status = 'registered';

  return jsonb_build_object(
    'outcome', 'cancelled',
    'organiser_id', v_organiser,
    'bookings', v_bookings,
    'reservations', v_reservations,
    'attendee_ids', v_attendees
  );
end;
$$;

-- Only the server may run it.
revoke all on function cancel_event(uuid, text, uuid) from public, anon, authenticated;
grant execute on function cancel_event(uuid, text, uuid) to service_role;
