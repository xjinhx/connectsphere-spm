-- =============================================================================
-- SCRUM-150 — Suggest an alternative venue or arrangement
-- =============================================================================
-- AC1: when Venue Staff reject a line they may suggest another venue, date or
-- slots. The suggestion is kept on the rejected line, saved with the decision in
-- the same transaction: decide_venue_booking_request (SCRUM-155's version,
-- 20261007130000_venue_booking_conflicts.sql) is replaced to write it.
--
-- AC3: a suggestion is only a record. It books nothing, holds nothing and
-- creates no request: the coordinator starts a new request from it if they want.
-- =============================================================================

alter table venue_booking_request_line
  add column suggested_venue_id uuid references venues (id),
  add column suggested_date date,
  add column suggested_slots text[],
  -- A suggestion is all three or none of them.
  add constraint venue_booking_request_line_suggestion_complete check (
    (suggested_venue_id is null) = (suggested_date is null)
    and (suggested_date is null) = (suggested_slots is null)
  ),
  -- Only a rejected line carries one.
  add constraint venue_booking_request_line_suggestion_when_rejected check (
    suggested_venue_id is null or status = 'rejected'
  ),
  add constraint venue_booking_request_line_suggested_slots_known check (
    suggested_slots is null
    or (cardinality(suggested_slots) between 1 and 3 and suggested_slots <@ array['am', 'pm', 'night']::text[])
  );

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

  -- SCRUM-155 AC5: no approved slot may be one recorded as unavailable.
  if exists (
    select 1
    from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
    join venue_booking_request_line l on l.id = d.line_id
    join venue_unavailable_slot u
      on u.venue_id = v_venue_id and u.date = l.date and u.slot = any (l.time_slots)
    where d.decision = 'approve'
  ) then
    return jsonb_build_object('outcome', 'unavailable');
  end if;

  -- SCRUM-148 AC1 and AC5: each line's decision, who made it and when.
  -- SCRUM-150 AC1: a rejected line may carry a suggested venue, date and slots.
  update venue_booking_request_line l set
    status = case d.decision when 'approve' then 'approved' else 'rejected' end,
    decided_by = p_decided_by,
    decided_at = now(),
    rejection_reason = case d.decision when 'reject' then trim(d.reason) end,
    suggested_venue_id = case when d.decision = 'reject' then (d.suggestion ->> 'venue_id')::uuid end,
    suggested_date = case when d.decision = 'reject' then (d.suggestion ->> 'date')::date end,
    suggested_slots = case when d.decision = 'reject' and d.suggestion is not null
      then array(select jsonb_array_elements_text(d.suggestion -> 'slots')) end
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text, suggestion jsonb)
  where l.id = d.line_id;

  -- SCRUM-148 AC2: a confirmed booking in every approved slot. A slot that
  -- already holds one breaks venue_booking_one_per_slot, which undoes
  -- everything above too (SCRUM-155 AC1).
  insert into venue_booking (venue_id, event_request_id, date, slot, request_line_id)
  select v_venue_id, v_event_request_id, l.date, s.slot, l.id
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
  join venue_booking_request_line l on l.id = d.line_id
  cross join unnest(l.time_slots) as s (slot)
  where d.decision = 'approve';

  -- SCRUM-155 AC4: other events' pending lines on a slot just booked here are
  -- rejected: the slot is committed to another event.
  with rejected as (
    update venue_booking_request_line other_line set
      status = 'rejected',
      decided_by = p_decided_by,
      decided_at = now(),
      rejection_reason = 'This slot is committed to another event.'
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
          and b.slot = any (other_line.time_slots)
      )
    returning other_request.id
  )
  select coalesce(array_agg(distinct id), '{}') into v_auto_rejected from rejected;

  return jsonb_build_object('outcome', 'decided', 'autoRejectedRequestIds', to_jsonb(v_auto_rejected));
end;
$$;

-- Only the server may run it.
revoke all on function decide_venue_booking_request(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function decide_venue_booking_request(uuid, jsonb, uuid) to service_role;
