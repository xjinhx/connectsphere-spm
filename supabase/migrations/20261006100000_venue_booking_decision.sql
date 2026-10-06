-- =============================================================================
-- SCRUM-148 Approve a booking request: AC1, AC2, AC5
-- =============================================================================
-- AC1: approving a pending request with no conflict makes it Approved, with
--      the deciding staff member and the time recorded.
-- AC2: a confirmed booking then exists for the venue in every approved slot,
--      and the assigned coordinator is notified.
-- AC5: each line of a several-line request is approved or rejected on its
--      own; bookings are made only for approved lines; a mix makes the request
--      Partially Approved; each rejected line carries a reason.
--
-- Built on SCRUM-142's venue_booking_request and venue_booking_request_line
-- (20261006090000), which leave deciding a line to this story:
--
-- 1. A line can now be approved or rejected, with who decided, when, and the
--    reason for a rejection. The request has no status column of its own: its
--    status is worked out from its lines (requestStatusOf in
--    src/domain/venue-booking/policy.ts), so the two can never disagree.
-- 2. venue_booking stops being SCRUM-120's hand-filled stand-in (dummy D-04).
--    Each row is now one confirmed booking of one venue on one date and slot,
--    written by the decision below. A booking needs its own date and slot,
--    not its event's: one request can carry several dates, and only some of
--    its lines may be approved.
-- 3. One venue slot holds at most one confirmed booking, enforced here
--    (customer clarification #35: a hard block, not a warning). This is the
--    sprint goal's "without any double-booking".
-- 4. decide_venue_booking_request writes the line decisions and the bookings
--    in one transaction.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Deciding a line
-- -----------------------------------------------------------------------------
alter table venue_booking_request_line
  drop constraint venue_booking_request_line_status_known;

alter table venue_booking_request_line
  add constraint venue_booking_request_line_status_known
    check (status in ('pending', 'approved', 'rejected')),

  -- AC1: who decided and when. Restrict, the same as decided_by on
  -- event_request: deleting an account must not erase who decided what.
  add column decided_by uuid references auth.users (id) on delete restrict,
  add column decided_at timestamptz,

  -- AC5: why a line was rejected.
  add column rejection_reason text,

  -- A decided line always says who decided and when; a pending one never does.
  add constraint venue_booking_request_line_decision_recorded check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null)
  ),

  -- A rejected line carries a reason; no other line has one.
  add constraint venue_booking_request_line_reason_when_rejected check (
    (status = 'rejected' and length(trim(rejection_reason)) > 0)
    or (status <> 'rejected' and rejection_reason is null)
  );


-- -----------------------------------------------------------------------------
-- 2. venue_booking: one confirmed booking per venue, date and slot
--
-- D-04's stand-in rows were added by hand for testing and have no date or slot
-- of their own, so they cannot be carried over. They are removed.
-- -----------------------------------------------------------------------------
delete from venue_booking;

alter table venue_booking
  -- One event can now hold several bookings at one venue (several slots and
  -- dates), so "once per venue" no longer holds.
  drop constraint venue_booking_once_per_venue,

  add column date date not null,
  add column slot text not null
    constraint venue_booking_slot_known check (slot in ('am', 'pm', 'night')),

  -- The approved line this booking came from. Set null rather than cascade:
  -- if the line ever goes, the booking's own record stays.
  add column request_line_id uuid references venue_booking_request_line (id) on delete set null;


-- -----------------------------------------------------------------------------
-- 3. No double-booking
-- -----------------------------------------------------------------------------
create unique index if not exists venue_booking_one_per_slot
  on venue_booking (venue_id, date, slot)
  where status = 'confirmed';


-- -----------------------------------------------------------------------------
-- 4. The decision: line decisions and bookings in one transaction
--
-- p_decisions is a JSON array of {line_id, decision: 'approve'|'reject',
-- reason}. Returns 'decided', 'already_decided' (nothing was pending, e.g.
-- another Venue Staff member decided first) or 'incomplete' (the decisions
-- did not cover exactly the pending lines). The last two write nothing.
-- -----------------------------------------------------------------------------
create or replace function decide_venue_booking_request(
  p_request_id uuid,
  p_decisions jsonb,
  p_decided_by uuid
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_pending integer;
  v_matched integer;
begin
  -- Lock this request's lines, so two Venue Staff deciding at once take turns:
  -- the second finds nothing pending and is told so.
  perform 1 from venue_booking_request_line where request_id = p_request_id for update;

  select count(*) into v_pending
  from venue_booking_request_line
  where request_id = p_request_id and status = 'pending';

  if v_pending = 0 then
    return 'already_decided';
  end if;

  -- AC5: exactly one decision for every pending line, and nothing else.
  select count(distinct l.id) into v_matched
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
  join venue_booking_request_line l on l.id = d.line_id
  where l.request_id = p_request_id
    and l.status = 'pending'
    and d.decision in ('approve', 'reject');

  if v_matched <> v_pending or v_matched <> jsonb_array_length(p_decisions) then
    return 'incomplete';
  end if;

  -- AC1 and AC5: each line's decision, who made it and when.
  update venue_booking_request_line l set
    status = case d.decision when 'approve' then 'approved' else 'rejected' end,
    decided_by = p_decided_by,
    decided_at = now(),
    rejection_reason = case d.decision when 'reject' then trim(d.reason) end
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
  where l.id = d.line_id;

  -- AC2: a confirmed booking in every approved slot. A slot that already holds
  -- one breaks venue_booking_one_per_slot, which undoes everything above too.
  insert into venue_booking (venue_id, event_request_id, date, slot, request_line_id)
  select r.venue_id, r.event_request_id, l.date, s.slot, l.id
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
  join venue_booking_request_line l on l.id = d.line_id
  join venue_booking_request r on r.id = l.request_id
  cross join unnest(l.time_slots) as s (slot)
  where d.decision = 'approve';

  return 'decided';
end;
$$;

-- Only the server may run it.
revoke all on function decide_venue_booking_request(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function decide_venue_booking_request(uuid, jsonb, uuid) to service_role;


-- -----------------------------------------------------------------------------
-- D-04 replaced: SCRUM-120's capacity check reads a booking's own date
--
-- update_venue as last written by SCRUM-119 (20260927090000), with one change
-- in the booking check: "future" is now the booking's own date, not the
-- event's proposed date. The same function otherwise, so the same signature
-- and grants carry over.
-- -----------------------------------------------------------------------------
create or replace function update_venue(
  p_venue_id uuid,
  p_expected_updated_at timestamptz,
  p_name text default null,
  p_location_id uuid default null,
  p_max_capacity integer default null,
  p_operating_slots text[] default null,
  p_facility_ids uuid[] default null,
  p_accessibility_feature_ids uuid[] default null,
  p_layouts jsonb default null,
  p_confirm_affected_bookings boolean default false,
  p_today date default null,
  p_needs_setup_slot boolean default null,
  p_needs_turnaround_slot boolean default null
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_updated_at timestamptz;
  v_max_capacity integer;
  v_affected uuid[];
  v_today date := coalesce(p_today, timezone('Asia/Singapore', now())::date);
begin
  select updated_at, max_capacity into v_updated_at, v_max_capacity
  from venues
  where id = p_venue_id
  for update;

  if not found then
    return 'not_found';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    return 'stale';
  end if;

  if p_max_capacity is not null and p_max_capacity < v_max_capacity then
    -- SCRUM-148: the booking's own date; one event can hold several bookings.
    select coalesce(array_agg(distinct e.id), '{}') into v_affected
    from venue_booking b
    join event_request e on e.id = b.event_request_id
    where b.venue_id = p_venue_id
      and b.status = 'confirmed'
      and b.date >= v_today
      and e.expected_attendance > p_max_capacity;

    if cardinality(v_affected) > 0 and not coalesce(p_confirm_affected_bookings, false) then
      return 'affected_bookings';
    end if;

    insert into venue_capacity_notice (
      venue_id, event_request_id, coordinator_id,
      previous_capacity, new_capacity, expected_attendance
    )
    select p_venue_id, e.id, e.coordinator_id, v_max_capacity, p_max_capacity, e.expected_attendance
    from event_request e
    where e.id = any (v_affected);
  end if;

  update venues set
    name = coalesce(p_name, name),
    location_id = coalesce(p_location_id, location_id),
    max_capacity = coalesce(p_max_capacity, max_capacity),
    operating_slots = coalesce(p_operating_slots, operating_slots),
    needs_setup_slot = coalesce(p_needs_setup_slot, needs_setup_slot),
    needs_turnaround_slot = coalesce(p_needs_turnaround_slot, needs_turnaround_slot),
    updated_at = greatest(clock_timestamp(), v_updated_at + interval '1 microsecond')
  where id = p_venue_id;

  if p_facility_ids is not null then
    delete from venue_facilities where venue_id = p_venue_id;
    insert into venue_facilities (venue_id, facility_id)
    select p_venue_id, facility_id from unnest(p_facility_ids) as facility_id;
  end if;

  if p_accessibility_feature_ids is not null then
    delete from venue_accessibility_features where venue_id = p_venue_id;
    insert into venue_accessibility_features (venue_id, accessibility_feature_id)
    select p_venue_id, feature_id from unnest(p_accessibility_feature_ids) as feature_id;
  end if;

  if p_layouts is not null then
    delete from venue_layouts where venue_id = p_venue_id;
    insert into venue_layouts (venue_id, layout, capacity)
    select p_venue_id, layout, capacity
    from jsonb_to_recordset(p_layouts) as layouts (layout text, capacity integer);
  end if;

  return 'updated';
end;
$$;
