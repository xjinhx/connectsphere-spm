-- =============================================================================
-- SCRUM-190 - Approve a change request and apply it
-- =============================================================================
-- AC1: approving a Pending change request applies every selected field to the
--      event and flips the request to Approved.
-- AC2: if the approved change is significant (date, times, expected
--      attendance, venue requirements or equipment requirements) and the
--      event was Confirmed, it returns to Planning.
-- AC3: an affected arrangement that is not marked essential never blocks
--      re-confirmation - decided in src/domain/essential-arrangements/policy.ts
--      (outstandingReviewArrangements), not here.
-- AC4: every venue booking / equipment reservation the change affects is
--      flagged for review (review_required, SCRUM-111's own column and
--      mechanism - not a new one), and this function hands back the staff who
--      actioned each one so the service can notify them.
-- AC5, AC6: notifying registered attendees and the organiser who raised the
--      request are both done in src/domain/change-request/service.ts, after
--      this function returns, through the existing in-app mechanism.
--
-- Which change is "significant" (p_drop_to_planning) and which cause applies
-- to which kind of arrangement (p_booking_cause/p_reservation_cause) are
-- decided in TypeScript (src/domain/change-request/policy.ts,
-- changeRequestIsSignificant/changeRequestArrangementCauses - the latter
-- reusing SCRUM-111's changeCauses as-is) and passed in, the same pattern as
-- change_event_schedule (20261025183932_review_required_flag.sql).
-- =============================================================================

-- Returns {"outcome": ...}:
--   not_found            no such change request
--   not_pending          the change request is not Pending (TC-190 negative case)
--   event_not_found      its event request could not be found (should not happen)
--   not_assigned         p_coordinator_id is not the event's assigned coordinator
--   approved             AC1/AC2/AC4: applied, flagged, with "bookings",
--                        "reservations", "venueStaffIds", "equipmentStaffIds"
--                        and "eventStatus" (the event's status after the call)
create or replace function approve_change_request(
  p_change_request_id uuid,
  p_coordinator_id uuid,
  p_name text,
  p_purpose text,
  p_description text,
  p_proposed_date date,
  p_start_time time,
  p_end_time time,
  p_expected_attendance integer,
  p_room_layout text,
  p_accessibility_required boolean,
  p_accessibility_notes text,
  p_accessibility_feature_ids uuid[],
  p_preferred_location_id uuid,
  p_equipment_required boolean,
  p_equipment_items jsonb,
  p_technical_support_notes text,
  p_registration_required boolean,
  p_booking_cause text,
  p_reservation_cause text,
  p_drop_to_planning boolean
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_cr change_request%rowtype;
  v_event event_request%rowtype;
  v_bookings uuid[];
  v_reservations uuid[];
  v_venue_staff uuid[];
  v_equipment_staff uuid[];
  v_new_status text;
begin
  -- Locked, so two decisions on the same request cannot both proceed.
  select * into v_cr from change_request where id = p_change_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_cr.status <> 'pending' then
    return jsonb_build_object('outcome', 'not_pending');
  end if;

  select * into v_event from event_request where id = v_cr.event_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'event_not_found');
  end if;
  if v_event.coordinator_id is distinct from p_coordinator_id then
    return jsonb_build_object('outcome', 'not_assigned');
  end if;

  -- AC2: only a Confirmed event, and only when the change is significant.
  v_new_status := case when v_event.status = 'confirmed' and p_drop_to_planning then 'planning' else v_event.status end;

  update event_request set
    name = p_name,
    purpose = p_purpose,
    description = p_description,
    proposed_date = p_proposed_date,
    start_time = p_start_time,
    end_time = p_end_time,
    expected_attendance = p_expected_attendance,
    room_layout = p_room_layout,
    accessibility_required = p_accessibility_required,
    accessibility_notes = p_accessibility_notes,
    preferred_location_id = p_preferred_location_id,
    equipment_required = p_equipment_required,
    technical_support_notes = p_technical_support_notes,
    registration_required = p_registration_required,
    status = v_new_status::event_request_status,
    updated_at = now()
  where id = v_event.id;

  -- The chosen accessibility features (SCRUM-79's rule: only ever alongside
  -- a "yes") - the whole list replaced, the same way SCRUM-79's own save does.
  delete from event_request_accessibility_features where event_request_id = v_event.id;
  if p_accessibility_required is true and p_accessibility_feature_ids is not null then
    insert into event_request_accessibility_features (event_request_id, accessibility_feature_id)
    select v_event.id, feature_id from unnest(p_accessibility_feature_ids) as feature_id;
  end if;

  -- The equipment item list - replaced whole, position recomputed from order.
  delete from event_request_equipment where event_request_id = v_event.id;
  if p_equipment_items is not null then
    insert into event_request_equipment (event_request_id, position, item, quantity)
    select
      v_event.id,
      (row_number() over () - 1)::smallint,
      item ->> 'item',
      (item ->> 'quantity')::integer
    from jsonb_array_elements(p_equipment_items) as item;
  end if;

  -- AC4: only confirmed bookings / reserved reservations are live arrangements
  -- to flag (a released one is no longer one - SCRUM-111's own rule).
  select coalesce(array_agg(id order by date, start_time), '{}') into v_bookings
  from venue_booking
  where event_request_id = v_event.id and status = 'confirmed' and p_booking_cause is not null;

  select coalesce(array_agg(id order by created_at, id), '{}') into v_reservations
  from equipment_reservation
  where event_request_id = v_event.id and status = 'reserved' and p_reservation_cause is not null;

  update venue_booking set
    review_required = true,
    review_required_at = now(),
    review_required_cause = p_booking_cause
  where id = any (v_bookings);

  update equipment_reservation set
    review_required = true,
    review_required_at = now(),
    review_required_cause = p_reservation_cause,
    updated_at = now()
  where id = any (v_reservations);

  -- AC4's "the staff who actioned them": the Venue Staff who decided the
  -- booking's request line, and the Technical Support staff who reserved the
  -- equipment - not whoever is currently assigned.
  select coalesce(array_agg(distinct vbrl.decided_by), '{}') into v_venue_staff
  from venue_booking vb
  join venue_booking_request_line vbrl on vbrl.id = vb.request_line_id
  where vb.id = any (v_bookings) and vbrl.decided_by is not null;

  select coalesce(array_agg(distinct er.reserved_by), '{}') into v_equipment_staff
  from equipment_reservation er
  where er.id = any (v_reservations) and er.reserved_by is not null;

  -- AC1: the request itself, decided.
  update change_request set
    status = 'approved',
    decided_by = p_coordinator_id,
    decided_at = now()
  where id = p_change_request_id;

  return jsonb_build_object(
    'outcome', 'approved',
    'bookings', to_jsonb(v_bookings),
    'reservations', to_jsonb(v_reservations),
    'venueStaffIds', to_jsonb(v_venue_staff),
    'equipmentStaffIds', to_jsonb(v_equipment_staff),
    'eventStatus', v_new_status
  );
end;
$$;

-- Only the server may run it.
revoke all on function approve_change_request(
  uuid, uuid, text, text, text, date, time, time, integer, text, boolean, text, uuid[], uuid, boolean, jsonb, text, boolean, text, text, boolean
) from public, anon, authenticated;
grant execute on function approve_change_request(
  uuid, uuid, text, text, text, date, time, time, integer, text, boolean, text, uuid[], uuid, boolean, jsonb, text, boolean, text, text, boolean
) to service_role;

-- -----------------------------------------------------------------------------
-- AC4, AC5, AC6 - three new notification types, the same pattern as
-- 20261024090000_change_request.sql.
-- Restates every type already allowed, including SCRUM-105's 'event_cancelled'
-- (20261030070000_cancel_event.sql, which runs before this one).
-- -----------------------------------------------------------------------------
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
    'event_confirmed',
    'equipment_unable_to_fulfil',
    'change_requested',
    'event_cancelled',
    'change_request_approved',
    'arrangement_needs_review',
    'event_details_changed'
  ));
