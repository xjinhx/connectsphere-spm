-- =============================================================================
-- Time model: clock times on the 15-minute booking unit (Sprint 3 shared
-- migration, Time model lane).
--
-- SCRUM-239 Check venue availability in 15-minute time ranges
-- SCRUM-238 Request event times in 15-minute steps
-- SCRUM-226 Treat setup and turnaround time as committed
--
-- Customer change Week 7 #1 (forum #126, #128; "15 minutes" clarified in #131):
-- the smallest booking unit is now 15 minutes, not the AM / PM / Night slot.
--
-- This migration ONLY ADDS. Every new time column is filled from the slot it
-- replaces (AM 07:00-12:00, PM 13:00-18:00, Night 19:00-24:00, the times in
-- TIME_SLOT_HOURS and SCRUM-238 AC6), and a trigger keeps it filled while the
-- existing code still writes slots. Nothing is dropped and no function
-- changes, so every merged story keeps working while each one switches over.
-- Dropping the slot columns is a later migration, once nothing reads them.
--
-- Times are Postgres `time`, Singapore clock time. `24:00` is a valid `time`
-- and is the end of the day (a former Night slot ends at 24:00).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- The clock times of each slot. One place, so every backfill below agrees.
create or replace function slot_start_time(p_slot text) returns time
language sql immutable set search_path = public as $$
  select case p_slot when 'am' then time '07:00' when 'pm' then time '13:00' when 'night' then time '19:00' end
$$;

create or replace function slot_end_time(p_slot text) returns time
language sql immutable set search_path = public as $$
  select case p_slot when 'am' then time '12:00' when 'pm' then time '18:00' when 'night' then time '24:00' end
$$;

-- On the 15-minute unit: :00, :15, :30 or :45, no seconds.
create or replace function is_quarter_hour(p_time time) returns boolean
language sql immutable set search_path = public as $$
  select extract(second from p_time) = 0 and extract(minute from p_time)::int % 15 = 0
$$;

-- Fills start_time / end_time from a single `slot` column, on insert when the
-- caller gave no times, and on update when the slot changed but the times did
-- not. Lets the existing slot-writing code (decide_venue_booking_request,
-- mark_slots_unavailable) keep working unchanged.
create or replace function fill_times_from_slot() returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.start_time is null)
     or (tg_op = 'UPDATE' and new.slot is distinct from old.slot
         and new.start_time is not distinct from old.start_time
         and new.end_time is not distinct from old.end_time) then
    new.start_time := slot_start_time(new.slot);
    new.end_time := slot_end_time(new.slot);
  end if;
  return new;
end;
$$;

-- The same for a `time_slots` array: from the first slot's start to the last
-- slot's end. A request for AM + PM becomes 07:00-18:00 (see the note at
-- event_request below). A null or empty array leaves the times alone.
create or replace function fill_times_from_slots() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.time_slots is not null and cardinality(new.time_slots) > 0 and (
       (tg_op = 'INSERT' and new.start_time is null)
       or (tg_op = 'UPDATE' and new.time_slots is distinct from old.time_slots
           and new.start_time is not distinct from old.start_time
           and new.end_time is not distinct from old.end_time)) then
    select min(slot_start_time(s)), max(slot_end_time(s)) into new.start_time, new.end_time
    from unnest(new.time_slots) as s;
  end if;
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- venues: opening hours (SCRUM-239 AC1) and setup / turnaround (SCRUM-225, 226)
-- -----------------------------------------------------------------------------

alter table venues
  add column opens_at time,
  add column closes_at time,
  -- PO decision, 8 Oct 2026: default 0 and 0. Nothing in the customer pack gives
  -- real values, and anything else would silently shrink availability around
  -- existing bookings. Venue Staff set the real values through SCRUM-225.
  add column setup_minutes integer not null default 0
    constraint venues_setup_minutes_quarter_hours check (setup_minutes >= 0 and setup_minutes % 15 = 0),
  add column turnaround_minutes integer not null default 0
    constraint venues_turnaround_minutes_quarter_hours check (turnaround_minutes >= 0 and turnaround_minutes % 15 = 0);

-- Opening hours from the slots each venue operates: first slot's start to last
-- slot's end. A venue running AM + PM opens 07:00-18:00; one running all three
-- opens 07:00-24:00. The old lunch and dinner gaps disappear, which is the
-- change the customer asked for (SCRUM-238 AC3: no lunch or dinner break).
update venues v set
  opens_at = (select min(slot_start_time(s)) from unnest(v.operating_slots) as s),
  closes_at = (select max(slot_end_time(s)) from unnest(v.operating_slots) as s);

-- Until the venue form saves hours directly (SCRUM-239 AC1), keep them in step
-- with operating_slots, which update_venue still writes.
create or replace function fill_venue_hours_from_slots() returns trigger
language plpgsql set search_path = public as $$
begin
  if (tg_op = 'INSERT' and new.opens_at is null)
     or (tg_op = 'UPDATE' and new.operating_slots is distinct from old.operating_slots
         and new.opens_at is not distinct from old.opens_at
         and new.closes_at is not distinct from old.closes_at) then
    select min(slot_start_time(s)), max(slot_end_time(s)) into new.opens_at, new.closes_at
    from unnest(new.operating_slots) as s;
  end if;
  return new;
end;
$$;

create trigger venues_fill_hours before insert or update on venues
  for each row execute function fill_venue_hours_from_slots();

alter table venues
  alter column opens_at set not null,
  alter column closes_at set not null,
  add constraint venues_hours_quarter_hours check (is_quarter_hour(opens_at) and is_quarter_hour(closes_at)),
  add constraint venues_closes_after_opens check (closes_at > opens_at);


-- -----------------------------------------------------------------------------
-- venue_booking: a confirmed booking's times (SCRUM-239 AC2-AC5)
-- -----------------------------------------------------------------------------

alter table venue_booking
  add column start_time time,
  add column end_time time;

update venue_booking set start_time = slot_start_time(slot), end_time = slot_end_time(slot);

create trigger venue_booking_fill_times before insert or update on venue_booking
  for each row execute function fill_times_from_slot();

alter table venue_booking
  alter column start_time set not null,
  alter column end_time set not null,
  add constraint venue_booking_times_quarter_hours check (is_quarter_hour(start_time) and is_quarter_hour(end_time)),
  add constraint venue_booking_ends_after_start check (end_time > start_time);

-- getVenueCommitments reads a venue's bookings by date.
create index if not exists venue_booking_venue_date_idx on venue_booking (venue_id, date);


-- -----------------------------------------------------------------------------
-- venue_booking_request_line: a requested period (SCRUM-239 AC3, AC4)
-- -----------------------------------------------------------------------------

alter table venue_booking_request_line
  add column start_time time,
  add column end_time time;

update venue_booking_request_line l set
  start_time = (select min(slot_start_time(s)) from unnest(l.time_slots) as s),
  end_time = (select max(slot_end_time(s)) from unnest(l.time_slots) as s);

create trigger venue_booking_request_line_fill_times before insert or update on venue_booking_request_line
  for each row execute function fill_times_from_slots();

alter table venue_booking_request_line
  alter column start_time set not null,
  alter column end_time set not null,
  add constraint venue_booking_request_line_times_quarter_hours check (is_quarter_hour(start_time) and is_quarter_hour(end_time)),
  add constraint venue_booking_request_line_ends_after_start check (end_time > start_time);


-- -----------------------------------------------------------------------------
-- venue_unavailable_slot: a withdrawn period (SCRUM-239 AC6, AC8)
-- -----------------------------------------------------------------------------

alter table venue_unavailable_slot
  add column start_time time,
  add column end_time time;

update venue_unavailable_slot set start_time = slot_start_time(slot), end_time = slot_end_time(slot);

create trigger venue_unavailable_slot_fill_times before insert or update on venue_unavailable_slot
  for each row execute function fill_times_from_slot();

alter table venue_unavailable_slot
  alter column start_time set not null,
  alter column end_time set not null,
  add constraint venue_unavailable_slot_times_quarter_hours check (is_quarter_hour(start_time) and is_quarter_hour(end_time)),
  add constraint venue_unavailable_slot_ends_after_start check (end_time > start_time);


-- -----------------------------------------------------------------------------
-- event_request: the event's own times (SCRUM-238)
-- -----------------------------------------------------------------------------

-- Nullable: a draft may not have its times yet, as time_slots may be null today
-- (SCRUM-77 AC1). A request with AM + PM becomes 07:00-18:00, the span the
-- organiser asked for; SCRUM-238 AC6 names single slots only.
alter table event_request
  add column start_time time,
  add column end_time time;

update event_request e set
  start_time = (select min(slot_start_time(s)) from unnest(e.time_slots) as s),
  end_time = (select max(slot_end_time(s)) from unnest(e.time_slots) as s)
where e.time_slots is not null and cardinality(e.time_slots) > 0;

create trigger event_request_fill_times before insert or update on event_request
  for each row execute function fill_times_from_slots();

alter table event_request
  add constraint event_request_times_together check ((start_time is null) = (end_time is null)),
  add constraint event_request_times_quarter_hours check (
    start_time is null or (is_quarter_hour(start_time) and is_quarter_hour(end_time))
  ),
  add constraint event_request_ends_after_start check (start_time is null or end_time > start_time);


-- =============================================================================
-- Multi-venue lane (SCRUM-230, 231): not in this migration
--
-- Agreed with the multi-venue lane on 9 Oct 2026: their columns go in their own
-- migration, timestamped after this one, in the SCRUM-230 / SCRUM-231 PRs that
-- use them. They touch other columns (venue_booking status and release reason;
-- venue_booking_request attendance, layout and accessibility), and venue_booking
-- has allowed several bookings per event since 20261007090000.
--
-- getVenueCommitments reads only confirmed bookings, so a booking SCRUM-231
-- releases stops committing the venue without any change here.
-- =============================================================================
