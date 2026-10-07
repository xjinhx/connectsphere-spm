-- =============================================================================
-- SCRUM-155 — Block approval of a conflicting booking
-- =============================================================================
-- Replaces SCRUM-148's decide_venue_booking_request
-- (20261007090000_venue_booking_decision.sql) with two more rules, still in
-- the one transaction:
--
-- AC5: a line is never approved on a slot recorded as unavailable
-- (venue_unavailable_slot, SCRUM-151). The service checks first, so it can show
-- the recorded reason; this is the guarantee if a slot is withdrawn in between.
--
-- AC4: once the approved slots are booked, every other event's pending line at
-- the same venue that names one of those slots is rejected, with the reason
-- that the slot is committed to another event, decided by the same staff
-- member at the same moment. Those requests are returned, so the service can
-- notify each one's coordinator.
--
-- AC1's refusal stays venue_booking_one_per_slot's job, as in SCRUM-148.
--
-- It now returns jsonb, {"outcome": ..., "autoRejectedRequestIds": [...]}, so
-- the old function is dropped rather than replaced.
-- =============================================================================

drop function if exists decide_venue_booking_request(uuid, jsonb, uuid);

create function decide_venue_booking_request(
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
  update venue_booking_request_line l set
    status = case d.decision when 'approve' then 'approved' else 'rejected' end,
    decided_by = p_decided_by,
    decided_at = now(),
    rejection_reason = case d.decision when 'reject' then trim(d.reason) end
  from jsonb_to_recordset(p_decisions) as d (line_id uuid, decision text, reason text)
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
