-- =============================================================================
-- SCRUM-239 Check venue availability in 15-minute time ranges, Part 3/4:
-- booking requests and approvals in exact times
-- =============================================================================
-- AC3: a request for a period that overlaps a committed one is refused, naming
--      the clashing period and no other event's details.
-- AC4: approving a request that now overlaps a confirmed booking is refused,
--      naming the period and the event holding it (as SCRUM-155 AC1).
-- AC7: bookings made under the slot model keep their times (filled by the
--      time-model migration) and still clash.
-- AC8: a request or approval overlapping an unavailable period is refused.
--
-- The checks that name what clashes are in the app (venue-booking/service.ts,
-- through getVenueCommitments). This migration is the database side, the
-- follow-ups agreed on PR #89 (time-model migration):
--
-- 1. Slots are optional. A new request line has a start and end time and no
--    slots; a booking made from it has no slot. Slot columns stay for rows
--    written before the switch, and are dropped in a later migration once
--    nothing reads them.
-- 2. venue_booking_one_per_slot is replaced by an overlap exclusion on the
--    times, so the database still refuses a double booking however it is
--    written, now to the minute (half-open: 10:00-12:00 and 12:00-14:00 do not
--    overlap). Setup and turnaround (SCRUM-226) are not part of it: the app
--    widens commitments by them, the constraint covers the booked times.
-- 3. create_venue_booking_request takes a start and end time per line.
--    A line sent with time_slots is still accepted (older callers and tests),
--    and the time-model trigger fills its times.
-- 4. decide_venue_booking_request books each approved line's own period, and
--    re-checks unavailable periods and other events' active holds by time.
--    The event's own holds never block it (SCRUM-227 AC5); the booking closes
--    them (close_holds_on_booking, 20261011193100_venue_hold.sql).
-- 5. A rejected line's suggestion (SCRUM-150) carries a start and end time.
--
-- AM + Night (non-adjacent slots), PR #89 follow-up, decided: REFUSE. A new
-- request is one start-end period per line, so it cannot ask for two separate
-- periods on one line. A pending line written before the switch with AM and
-- Night but not PM cannot be approved as one period (07:00-24:00 would also
-- take PM), so its approval is refused and Venue Staff reject it instead; the
-- coordinator requests each period as its own line. AM + PM and PM + Night are
-- adjacent and become one period, as the time-model migration filled them.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Slots optional
-- -----------------------------------------------------------------------------

alter table venue_booking
  alter column slot drop not null;

alter table venue_booking_request_line
  alter column time_slots drop not null,
  drop constraint venue_booking_request_line_slots_valid,
  add constraint venue_booking_request_line_slots_valid check (
    time_slots is null
    or (array_length(time_slots, 1) between 1 and 3 and time_slots <@ array['am', 'pm', 'night']::text[])
  );


-- -----------------------------------------------------------------------------
-- 2. No double booking, by time
--
-- btree_gist lets the exclusion compare the venue and date with = alongside
-- the time range. date + time gives a timestamp, so 24:00 is the next
-- midnight and a range ending then still compares correctly.
-- -----------------------------------------------------------------------------

create extension if not exists btree_gist;

drop index if exists venue_booking_one_per_slot;

alter table venue_booking
  add constraint venue_booking_no_overlap exclude using gist (
    venue_id with =,
    tsrange(date + start_time, date + end_time) with &&
  ) where (status = 'confirmed');


-- -----------------------------------------------------------------------------
-- 5. A suggestion's period (SCRUM-150 AC1)
-- -----------------------------------------------------------------------------

alter table venue_booking_request_line
  add column suggested_start_time time,
  add column suggested_end_time time;

update venue_booking_request_line set
  suggested_start_time = (select min(slot_start_time(s)) from unnest(suggested_slots) as s),
  suggested_end_time = (select max(slot_end_time(s)) from unnest(suggested_slots) as s)
where suggested_slots is not null;

alter table venue_booking_request_line
  drop constraint venue_booking_request_line_suggestion_complete,
  add constraint venue_booking_request_line_suggestion_complete check (
    (suggested_venue_id is null) = (suggested_date is null)
    and (suggested_date is null) = (suggested_start_time is null)
    and (suggested_start_time is null) = (suggested_end_time is null)
  ),
  add constraint venue_booking_request_line_suggested_times_valid check (
    suggested_start_time is null
    or (
      is_quarter_hour(suggested_start_time)
      and is_quarter_hour(suggested_end_time)
      and suggested_end_time > suggested_start_time
    )
  );


-- -----------------------------------------------------------------------------
-- 3. Creating a request: each line is a date and a start and end time
-- -----------------------------------------------------------------------------

create or replace function create_venue_booking_request(
  p_event_request_id uuid,
  p_venue_id uuid,
  p_requested_by uuid,
  p_lines jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_request_id uuid;
begin
  insert into venue_booking_request (event_request_id, venue_id, requested_by)
  values (p_event_request_id, p_venue_id, p_requested_by)
  returning id into v_request_id;

  insert into venue_booking_request_line (request_id, date, start_time, end_time, time_slots)
  select
    v_request_id,
    (line ->> 'date')::date,
    (line ->> 'start')::time,
    (line ->> 'end')::time,
    case when line ? 'time_slots'
      then array(select jsonb_array_elements_text(line -> 'time_slots'))
    end
  from jsonb_array_elements(p_lines) as line;

  return v_request_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. Deciding a request: book each approved line's period
--
-- As SCRUM-150 left it (20261007140000_venue_booking_suggestion.sql), with:
--   - outcome 'non_adjacent_slots': an approved line written before the switch
--     asks for AM and Night but not PM (see the header);
--   - outcome 'unavailable': compared by time, not slot (AC8);
--   - outcome 'held': another event's active hold overlaps (SCRUM-227 AC4);
--     the event's own holds are skipped (SCRUM-227 AC5);
--   - one confirmed booking per approved line, for the line's start and end;
--     an overlapping confirmed booking breaks venue_booking_no_overlap, which
--     undoes everything (AC4, SCRUM-155 AC1);
--   - SCRUM-155 AC4 by time: other events' pending lines that overlap a period
--     just booked are rejected.
-- -----------------------------------------------------------------------------

create or replace function decide_venue_booking_request(
  p_request_id uuid,
  p_decisions jsonb,
  p_decided_by uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_pending integer;
  v_matched integer;
  v_venue_id uuid;
  v_event_request_id uuid;
  v_auto_rejected uuid[];
begin
  -- Lock this request's lines, so two Venue Staff deciding at once take turns:
  -- the second finds nothing pending and is told so.
  perform 1 from venue_booking_request_line where request_id = p_request_id for update;

  select count(*) into v_pending
  from venue_booking_request_line
  where request_id = p_request_id and status = 'pending';

  if v_pending = 0 then
    return jsonb_build_object('outcome', 'already_decided');
  end if;

  -- SCRUM-148 AC5: exactly one decision for every pending line, and nothing else.
  select count(distinct l.id) into v_matched
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
  join venue_booking_request_line l on l.id = d.line_id
  where l.request_id = p_request_id
    and l.status = 'pending'
    and d.decision in ('approve', 'reject');

  if v_matched <> v_pending or v_matched <> jsonb_array_length(p_decisions) then
    return jsonb_build_object('outcome', 'incomplete');
  end if;

  select venue_id, event_request_id into v_venue_id, v_event_request_id
  from venue_booking_request
  where id = p_request_id;

  -- PR #89 follow-up: AM + Night without PM is two periods, not one.
  if exists (
    select 1
    from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text)
    join venue_booking_request_line l on l.id = d.line_id
    where d.decision = 'approve'
      and l.time_slots @> array['am', 'night']::text[]
      and not l.time_slots @> array['pm']::text[]
  ) then
    return jsonb_build_object('outcome', 'non_adjacent_slots');
  end if;

  -- SCRUM-239 AC8, SCRUM-155 AC5: no approved period may overlap one recorded
  -- as unavailable.
  if exists (
    select 1
    from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text)
    join venue_booking_request_line l on l.id = d.line_id
    join venue_unavailable_slot u
      on u.venue_id = v_venue_id
     and u.date = l.date
     and u.start_time < l.end_time
     and l.start_time < u.end_time
    where d.decision = 'approve'
  ) then
    return jsonb_build_object('outcome', 'unavailable');
  end if;

  -- SCRUM-227 AC4: nor another event's active hold. AC5: the event's own
  -- holds do not count; the booking below closes them.
  if exists (
    select 1
    from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text)
    join venue_booking_request_line l on l.id = d.line_id
    join venue_hold h
      on h.venue_id = v_venue_id
     and h.date = l.date
     and h.status = 'active'
     and h.expires_at > now()
     and h.event_request_id <> v_event_request_id
     and h.start_time < l.end_time
     and l.start_time < h.end_time
    where d.decision = 'approve'
  ) then
    return jsonb_build_object('outcome', 'held');
  end if;

  -- SCRUM-148 AC1 and AC5: each line's decision, who made it and when.
  -- SCRUM-150 AC1: a rejected line may carry a suggested venue, date and period.
  update venue_booking_request_line l set
    status = case d.decision when 'approve' then 'approved' else 'rejected' end,
    decided_by = p_decided_by,
    decided_at = now(),
    rejection_reason = case d.decision when 'reject' then trim(d.reason) end,
    suggested_venue_id = case when d.decision = 'reject' then (d.suggestion ->> 'venue_id')::uuid end,
    suggested_date = case when d.decision = 'reject' then (d.suggestion ->> 'date')::date end,
    suggested_start_time = case when d.decision = 'reject' then (d.suggestion ->> 'start')::time end,
    suggested_end_time = case when d.decision = 'reject' then (d.suggestion ->> 'end')::time end
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text, suggestion jsonb)
  where l.id = d.line_id;

  -- SCRUM-148 AC2: a confirmed booking for every approved line's period. One
  -- that overlaps a confirmed booking breaks venue_booking_no_overlap, which
  -- undoes everything above too (SCRUM-239 AC4, SCRUM-155 AC1).
  insert into venue_booking (venue_id, event_request_id, date, start_time, end_time, request_line_id)
  select v_venue_id, v_event_request_id, l.date, l.start_time, l.end_time, l.id
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text)
  join venue_booking_request_line l on l.id = d.line_id
  where d.decision = 'approve';

  -- SCRUM-155 AC4, in time: other events' pending lines that overlap a period
  -- just booked here are rejected, as it is committed to another event.
  with rejected as (
    update venue_booking_request_line other_line set
      status = 'rejected',
      decided_by = p_decided_by,
      decided_at = now(),
      rejection_reason = 'This period is committed to another event.'
    from venue_booking_request other_request
    where other_line.request_id = other_request.id
      and other_request.venue_id = v_venue_id
      and other_request.event_request_id <> v_event_request_id
      and other_line.status = 'pending'
      and exists (
        select 1
        from venue_booking b
        join venue_booking_request_line booked_line on booked_line.id = b.request_line_id
        where booked_line.request_id = p_request_id
          and b.status = 'confirmed'
          and b.date = other_line.date
          and b.start_time < other_line.end_time
          and other_line.start_time < b.end_time
      )
    returning other_request.id
  )
  select coalesce(array_agg(distinct id), '{}') into v_auto_rejected from rejected;

  return jsonb_build_object('outcome', 'decided', 'autoRejectedRequestIds', to_jsonb(v_auto_rejected));
end;
$$;

-- Only the server may run them.
revoke all on function create_venue_booking_request(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function create_venue_booking_request(uuid, uuid, uuid, jsonb) to service_role;
revoke all on function decide_venue_booking_request(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function decide_venue_booking_request(uuid, jsonb, uuid) to service_role;
