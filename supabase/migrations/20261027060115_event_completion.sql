-- =============================================================================
-- SCRUM-104 — Mark an event as completed
-- =============================================================================
-- AC1: the assigned coordinator marks a Preparation event completed once its
--      end date has passed; the time and who did it are recorded.
-- AC2: seven or more days after its end date, the daily completion check
--      completes a Preparation event, recorded as system-completed (no
--      completed_by).
-- AC3: six days is not enough.
-- AC4: never before its end date has passed.
-- AC5: Preparation only. An event reaches Preparation only through an approved
--      safety check (record_safety_check, SCRUM-234), so in any other status it
--      has not passed one (CL-60).
--
-- The end date is the last day of the event's confirmed venue bookings, or its
-- proposed date when it has none; it has passed when it is before today in
-- Singapore (agreed 23/10/2026). Who may mark it is checked in
-- src/domain/event-status/service.ts before complete_event is called; the
-- status and end-date rules are restated there for the page (canBeCompleted,
-- hasEnded, isDueForCompletionCheck in policy.ts): change one, change the other.
-- =============================================================================

alter table event_request
  add column completed_at timestamptz,
  -- Null on a completed event means the completion check completed it (AC2).
  -- Restrict, as decided_by elsewhere: deleting an account must not erase who
  -- completed what.
  add column completed_by uuid references auth.users (id) on delete restrict,
  -- Recorded on a completed event only, and a completer only with a time.
  add constraint event_request_completion_recorded check (
    (status = 'completed' or (completed_at is null and completed_by is null))
    and (completed_by is null or completed_at is not null)
  );

-- -----------------------------------------------------------------------------
-- The end date: the last confirmed booking day, else the proposed date. Null
-- when the event has neither.
-- -----------------------------------------------------------------------------
create function event_end_date(p_event_request_id uuid)
returns date
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select max(b.date) from venue_booking b
      where b.event_request_id = p_event_request_id and b.status = 'confirmed'),
    (select e.proposed_date from event_request e where e.id = p_event_request_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- AC1, AC4, AC5: the coordinator marks the event completed.
-- -----------------------------------------------------------------------------
-- The event is locked first, so this and the completion check take turns: the
-- second finds it no longer in Preparation and changes nothing.
--
-- Returns 'completed'; 'not_preparation' when the event is not (or no longer)
-- in Preparation (AC5); 'not_ended' when its end date is today or later, or it
-- has none (AC4). Nothing changes unless it returns 'completed'.
create function complete_event(p_event_request_id uuid, p_completed_by uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_status event_request_status;
  v_end date;
begin
  select status into v_status from event_request where id = p_event_request_id for update;

  if v_status is distinct from 'preparation' then
    return 'not_preparation';
  end if;

  -- Never current_date: the database runs in UTC, which is still on yesterday
  -- until 08:00 in Singapore.
  v_end := event_end_date(p_event_request_id);
  if v_end is null or v_end >= timezone('Asia/Singapore', now())::date then
    return 'not_ended';
  end if;

  update event_request
  set status = 'completed', completed_at = now(), completed_by = p_completed_by
  where id = p_event_request_id;

  return 'completed';
end;
$$;

-- -----------------------------------------------------------------------------
-- AC2, AC3: the completion check. Completes every Preparation event whose end
-- date was 7 or more days before p_today (so one the check missed for a day is
-- still completed), recorded as system-completed. Any other status is left as
-- it is (CL-60). Returns how many it completed.
--
-- p_today is for tests; left out, it is today in Singapore.
-- -----------------------------------------------------------------------------
create function complete_past_events(p_today date default timezone('Asia/Singapore', now())::date)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_completed integer;
begin
  update event_request
  set status = 'completed', completed_at = now(), completed_by = null
  where status = 'preparation'
    and event_end_date(id) <= p_today - 7;
  get diagnostics v_completed = row_count;

  return v_completed;
end;
$$;

-- Only the server and pg_cron run them.
revoke all on function event_end_date(uuid) from public, anon, authenticated;
grant execute on function event_end_date(uuid) to service_role;
revoke all on function complete_event(uuid, uuid) from public, anon, authenticated;
grant execute on function complete_event(uuid, uuid) to service_role;
revoke all on function complete_past_events(date) from public, anon, authenticated;
grant execute on function complete_past_events(date) to service_role;

-- -----------------------------------------------------------------------------
-- Daily at 16:05 UTC, 00:05 in Singapore, just after the date changes.
-- cron.schedule replaces a job of the same name, so a reset leaves one job.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule('complete-past-events', '5 16 * * *', 'select public.complete_past_events()');
