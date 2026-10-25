-- =============================================================================
-- SCRUM-111 - Flag affected arrangements and mark them for review after a
--             significant change (absorbs SCRUM-112)
-- =============================================================================
-- "As an Event Coordinator, I want the system to tell me when a change I am
-- making affects arrangements already agreed, and mark those arrangements for
-- review, so that I do not silently invalidate a venue booking or equipment
-- reservation and nothing is left assumed valid after the event has moved."
--
-- 1. A review-required flag on each arrangement: venue_booking (AC6) and
--    equipment_reservation (AC7), with when it was set and the change that
--    caused it (AC5), and who re-confirmed it and when (AC9).
-- 2. change_event_schedule: the coordinator's significant change - date,
--    times, expected attendance, venue requirements - saved together with the
--    flags in one transaction, and refused without the acknowledgement when an
--    arrangement is affected (AC1, AC2).
--
-- Which change affects which arrangement is decided in
-- src/domain/significant-change/policy.ts (AC1: a venue booking by date, times,
-- attendance or requirements; AC2: an equipment reservation by date or times),
-- and passed in here as the cause for each kind. A null cause is "this kind is
-- not affected".
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The flag
-- -----------------------------------------------------------------------------
-- review_required_at and review_required_cause describe the latest time the
-- flag was set, and are kept after a re-confirmation as history; the flag
-- itself is what AC8 reads. reconfirmed_by and reconfirmed_at are the latest
-- re-confirmation (AC9). Restrict, as released_by and reserved_by.
alter table venue_booking
  add column review_required boolean not null default false,
  add column review_required_at timestamptz,
  add column review_required_cause text,
  add column reconfirmed_by uuid references auth.users (id) on delete restrict,
  add column reconfirmed_at timestamptz,
  add constraint venue_booking_review_flag_described check (
    not review_required or (review_required_at is not null and btrim(coalesce(review_required_cause, '')) <> '')
  ),
  add constraint venue_booking_reconfirmed_together check ((reconfirmed_by is null) = (reconfirmed_at is null));

alter table equipment_reservation
  add column review_required boolean not null default false,
  add column review_required_at timestamptz,
  add column review_required_cause text,
  add column reconfirmed_by uuid references auth.users (id) on delete restrict,
  add column reconfirmed_at timestamptz,
  add constraint equipment_reservation_review_flag_described check (
    not review_required or (review_required_at is not null and btrim(coalesce(review_required_cause, '')) <> '')
  ),
  add constraint equipment_reservation_reconfirmed_together check ((reconfirmed_by is null) = (reconfirmed_at is null));

-- -----------------------------------------------------------------------------
-- 2. The significant change
-- -----------------------------------------------------------------------------
-- Returns {"outcome": ...}:
--   not_found                no such event
--   not_assigned             p_coordinator_id is not the event's coordinator
--   finished                 the event is Completed or Cancelled (SCRUM-110 AC5);
--                            with "status"
--   changed                  the event was saved by someone else after the
--                            service read it (p_expected_updated_at), so the
--                            causes passed in may be out of date
--   acknowledgement_required AC1, AC2: an arrangement is affected and
--                            p_acknowledged is false; nothing is saved. With
--                            "bookings" and "reservations", the ids affected
--   saved                    AC4, AC5: saved, every affected arrangement
--                            flagged; with "bookings" and "reservations"
--
-- AC4: no cut-off. Nothing here looks at how soon the event starts.
--
-- Only confirmed bookings (a released one is no longer an arrangement) and
-- reserved reservations are flagged. A flag already set is set again with the
-- new time and cause: the latest change is the one to review against.
create or replace function change_event_schedule(
  p_event_request_id uuid,
  p_coordinator_id uuid,
  p_expected_updated_at timestamptz,
  p_proposed_date date,
  p_start_time time,
  p_end_time time,
  p_expected_attendance integer,
  p_room_layout text,
  p_accessibility_required boolean,
  p_accessibility_notes text,
  p_booking_cause text,
  p_reservation_cause text,
  p_acknowledged boolean
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_event event_request%rowtype;
  v_bookings uuid[];
  v_reservations uuid[];
begin
  -- Locked, so a second change to the same event waits for this one and then
  -- sees it as "changed".
  select * into v_event from event_request where id = p_event_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_event.coordinator_id is distinct from p_coordinator_id then
    return jsonb_build_object('outcome', 'not_assigned');
  end if;
  if v_event.status in ('completed', 'cancelled') then
    return jsonb_build_object('outcome', 'finished', 'status', v_event.status);
  end if;
  if v_event.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('outcome', 'changed');
  end if;

  select coalesce(array_agg(id order by date, start_time), '{}') into v_bookings
  from venue_booking
  where event_request_id = p_event_request_id and status = 'confirmed' and p_booking_cause is not null;

  select coalesce(array_agg(id order by created_at, id), '{}') into v_reservations
  from equipment_reservation
  where event_request_id = p_event_request_id and status = 'reserved' and p_reservation_cause is not null;

  if (cardinality(v_bookings) > 0 or cardinality(v_reservations) > 0) and not p_acknowledged then
    return jsonb_build_object('outcome', 'acknowledgement_required', 'bookings', to_jsonb(v_bookings), 'reservations', to_jsonb(v_reservations));
  end if;

  update event_request set
    proposed_date = p_proposed_date,
    start_time = p_start_time,
    end_time = p_end_time,
    expected_attendance = p_expected_attendance,
    room_layout = p_room_layout,
    accessibility_required = p_accessibility_required,
    accessibility_notes = p_accessibility_notes
  where id = p_event_request_id;

  -- SCRUM-79's rule (normaliseAccessibility): features only go with a "yes".
  if p_accessibility_required is not true then
    delete from event_request_accessibility_features where event_request_id = p_event_request_id;
  end if;

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

  return jsonb_build_object('outcome', 'saved', 'bookings', to_jsonb(v_bookings), 'reservations', to_jsonb(v_reservations));
end;
$$;

-- Only the server may run it.
revoke all on function change_event_schedule(uuid, uuid, timestamptz, date, time, time, integer, text, boolean, text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function change_event_schedule(uuid, uuid, timestamptz, date, time, time, integer, text, boolean, text, text, text, boolean)
  to service_role;
