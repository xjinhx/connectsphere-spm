-- =============================================================================
-- SCRUM-228 Tell the coordinator when a hold is about to expire
-- =============================================================================
-- AC1: 24 hours before an active hold expires, the event's coordinator gets a
--      notification naming the venue, the date, the start and end time, and
--      the expiry.
-- AC2: when a hold expires without an approved booking, the coordinator gets a
--      notification that it has lapsed.
-- AC3: a hold that became a confirmed booking before it expired sends nothing
--      more: SCRUM-227 closes it (close_holds_on_booking), and only active
--      holds are looked at here.
--
-- Something has to notice the time passing, and nothing in the app runs on a
-- timer. notify_hold_expiries() does both checks and is run every 5 minutes by
-- pg_cron, inside the database, locally and on the cloud project alike.
-- Testers can run it by hand from Studio's SQL editor:
--     select notify_hold_expiries();
-- which is what "let the hold-expiry check run" means in the test cases.
--
-- Each hold is told once of each: the time each notification was sent is
-- stored on the hold, so a second run, or two runs at once, never repeat one.
-- A hold whose event has no coordinator is left until it has one, or until
-- the warning no longer applies.
--
-- Warning time is 24 hours (PO decision, 7 Oct 2026; customer #39, #41). A
-- hold made with less than 24 hours left is warned at the next run, then told
-- when it lapses (Slack, 10 Oct 2026).
--
-- The notifications are in-app (SCRUM-193's table), of the existing
-- 'venue_booking_update' type, the coordinator's venue notifications
-- (20261007080000). Reusing it leaves notifications_type_known alone, which
-- other Sprint 3 stories also widen.
-- =============================================================================

alter table venue_hold
  add column expiry_warning_sent_at timestamptz,
  add column lapse_notified_at timestamptz;


-- -----------------------------------------------------------------------------
-- "Bugis Seminar Room for 20 Nov 2026, 10:00-12:00": the hold's venue and
-- period, in the words both notifications use.
-- -----------------------------------------------------------------------------
create or replace function describe_hold_period(p_venue_name text, p_date date, p_start time, p_end time)
returns text
language sql immutable set search_path = public as $$
  select format('%s for %s, %s-%s',
    p_venue_name,
    to_char(p_date, 'FMDD Mon YYYY'),
    to_char(p_start, 'HH24:MI'),
    to_char(p_end, 'HH24:MI'))
$$;

-- "13 Nov 2026 17:00", in Singapore time.
create or replace function format_singapore_instant(p_instant timestamptz)
returns text
language sql stable set search_path = public as $$
  select to_char(p_instant at time zone 'Asia/Singapore', 'FMDD Mon YYYY HH24:MI')
$$;


-- -----------------------------------------------------------------------------
-- AC1 and AC2. Returns how many notifications were sent. p_now is for tests;
-- left out, it is the time of the run.
-- -----------------------------------------------------------------------------
create or replace function notify_hold_expiries(p_now timestamptz default now())
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_warned integer;
  v_lapsed integer;
begin
  -- AC1: active, not yet expired, expiring within 24 hours, not yet warned.
  with due as (
    select h.id
    from venue_hold h
    join event_request e on e.id = h.event_request_id
    where h.status = 'active'
      and h.expiry_warning_sent_at is null
      and h.expires_at > p_now
      and h.expires_at <= p_now + interval '24 hours'
      and e.coordinator_id is not null
    for update of h skip locked
  ),
  sent as (
    insert into notifications (recipient_id, type, event_request_id, message)
    select e.coordinator_id, 'venue_booking_update', h.event_request_id,
      format('Your hold on %s expires at %s. Finish the booking before then, or look for another venue.',
        describe_hold_period(v.name, h.date, h.start_time, h.end_time),
        format_singapore_instant(h.expires_at))
    from due
    join venue_hold h on h.id = due.id
    join event_request e on e.id = h.event_request_id
    join venues v on v.id = h.venue_id
    returning 1
  )
  update venue_hold set expiry_warning_sent_at = p_now
  where id in (select id from due);
  get diagnostics v_warned = row_count;

  -- AC2: still active (no booking closed it, AC3) and past its expiry.
  with due as (
    select h.id
    from venue_hold h
    join event_request e on e.id = h.event_request_id
    where h.status = 'active'
      and h.lapse_notified_at is null
      and h.expires_at <= p_now
      and e.coordinator_id is not null
    for update of h skip locked
  ),
  sent as (
    insert into notifications (recipient_id, type, event_request_id, message)
    select e.coordinator_id, 'venue_booking_update', h.event_request_id,
      format('Your hold on %s lapsed at %s without a confirmed booking. The venue is no longer held for this event.',
        describe_hold_period(v.name, h.date, h.start_time, h.end_time),
        format_singapore_instant(h.expires_at))
    from due
    join venue_hold h on h.id = due.id
    join event_request e on e.id = h.event_request_id
    join venues v on v.id = h.venue_id
    returning 1
  )
  update venue_hold set lapse_notified_at = p_now
  where id in (select id from due);
  get diagnostics v_lapsed = row_count;

  return v_warned + v_lapsed;
end;
$$;

-- Only the server and pg_cron run it.
revoke all on function notify_hold_expiries(timestamptz) from public, anon, authenticated;
grant execute on function notify_hold_expiries(timestamptz) to service_role;


-- -----------------------------------------------------------------------------
-- Every 5 minutes. cron.schedule replaces a job of the same name, so running
-- this again (a reset) leaves one job, not two.
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule('notify-hold-expiries', '*/5 * * * *', 'select public.notify_hold_expiries()');
