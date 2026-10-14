-- =============================================================================
-- SCRUM-239 Check venue availability in 15-minute time ranges, Part 4/4: AC6
-- =============================================================================
-- AC6: "Given Venue Staff mark a venue unavailable from 14:00 to 16:30, when
--      they save, then only bookings overlapping that period are flagged —
--      SCRUM-151's behaviour applied to time ranges."
--
-- SCRUM-151 (Done on slots) recorded slots as unavailable and flagged the
-- confirmed bookings on them (20261007110000, 20261007120000). This moves the
-- record, the flag and the notice to times. SCRUM-151 stays Done.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- AC6: a venue is marked unavailable for a period, not a slot
--
-- venue_unavailable_slot keeps its name (CONTEXT.md, and every story that
-- reads it) and has had start_time / end_time since the time-model migration.
-- A period is now written with its times and no slot, so:
--   - slot becomes optional (rows from before keep theirs, and their times);
--   - "marked twice" (venue_unavailable_slot_once, one row per slot) becomes
--     "overlaps a period already marked", the same exclusion the bookings got
--     in Part 3 (btree_gist, half-open), so 14:00-16:30 and 16:30-18:00 can
--     both be marked.
-- -----------------------------------------------------------------------------
create extension if not exists btree_gist;

alter table venue_unavailable_slot
  alter column slot drop not null,
  drop constraint if exists venue_unavailable_slot_once,
  add constraint venue_unavailable_slot_no_overlap exclude using gist (
    venue_id with =,
    tsrange(date + start_time, date + end_time) with &&
  );


-- -----------------------------------------------------------------------------
-- AC6: the flag, by time
--
-- affected_booking_slot (SCRUM-151 AC2) keeps its name and columns, so
-- SCRUM-151's readers and SCRUM-231's release (a released booking is no longer
-- confirmed, so it drops off) keep working. Only the match changes: a
-- confirmed booking is affected when its times overlap an unavailable period
-- at its venue on its date, half-open, so 12:00-14:00 is not affected by
-- 14:00-16:30 (TC-239-19) and 16:30-18:00 is not either (TC-239-14).
--
-- New columns go at the end (a view can only gain columns there): the
-- booking's times and the unavailable period's times.
-- -----------------------------------------------------------------------------
create or replace view affected_booking_slot
with (security_invoker = true) as
select
  b.id as booking_id,
  b.event_request_id,
  b.venue_id,
  b.date as slot_date,
  b.slot,
  u.reason,
  e.coordinator_id,
  b.start_time,
  b.end_time,
  u.start_time as unavailable_start_time,
  u.end_time as unavailable_end_time
from venue_booking b
join event_request e on e.id = b.event_request_id
join venue_unavailable_slot u
  on u.venue_id = b.venue_id
 and u.date = b.date
 and u.start_time < b.end_time
 and b.start_time < u.end_time
where b.status = 'confirmed';


-- -----------------------------------------------------------------------------
-- AC6: what the coordinator is told names the period, not slots
--
-- Notices from before keep their slots; a notice written from now on has the
-- withdrawn period's times instead.
-- -----------------------------------------------------------------------------
alter table venue_unavailability_notice
  alter column slots drop not null,
  add column start_time time,
  add column end_time time,
  add constraint venue_unavailability_notice_slots_or_times check (
    slots is not null or (start_time is not null and end_time is not null)
  );


-- -----------------------------------------------------------------------------
-- AC6: the save, by time
--
-- mark_period_unavailable replaces mark_slots_unavailable: one period, its
-- reason and who recorded it, and a notice for each upcoming event with a
-- confirmed booking overlapping it, in one transaction (SCRUM-151 AC1, AC2).
-- A period overlapping one already marked breaks venue_unavailable_slot_no_overlap
-- (23P01), which aborts the whole function, so nothing is saved and nobody is
-- told.
--
-- mark_slots_unavailable is dropped, so slots cannot be marked any more.
-- -----------------------------------------------------------------------------
drop function if exists mark_slots_unavailable(uuid, date, text[], text, uuid, date);

create function mark_period_unavailable(
  p_venue_id uuid,
  p_date date,
  p_start time,
  p_end time,
  p_reason text,
  p_recorded_by uuid,
  p_today date default null
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_today date := coalesce(p_today, timezone('Asia/Singapore', now())::date);
  v_notices jsonb;
begin
  insert into venue_unavailable_slot (venue_id, date, start_time, end_time, reason, recorded_by)
  values (p_venue_id, p_date, p_start, p_end, p_reason, p_recorded_by);

  -- One notice per event with a confirmed booking overlapping the period.
  with written as (
    insert into venue_unavailability_notice (
      venue_id, event_request_id, coordinator_id, slot_date, start_time, end_time, reason
    )
    select distinct a.venue_id, a.event_request_id, a.coordinator_id, a.slot_date, p_start, p_end, p_reason
    from affected_booking_slot a
    where a.venue_id = p_venue_id
      and a.slot_date = p_date
      and a.start_time < p_end
      and p_start < a.end_time
      and a.slot_date >= v_today
      and a.coordinator_id is not null
    returning event_request_id, coordinator_id, slot_date, start_time, end_time, reason
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventRequestId', event_request_id,
    'coordinatorId', coordinator_id,
    'date', slot_date,
    'start', to_char(start_time, 'HH24:MI'),
    'end', to_char(end_time, 'HH24:MI'),
    'reason', reason
  )), '[]'::jsonb)
  into v_notices
  from written;

  return v_notices;
end;
$$;

-- Only the server may run it, like update_venue.
revoke all on function mark_period_unavailable(uuid, date, time, time, text, uuid, date)
  from public, anon, authenticated;
grant execute on function mark_period_unavailable(uuid, date, time, time, text, uuid, date)
  to service_role;
