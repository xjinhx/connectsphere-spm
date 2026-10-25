-- =============================================================================
-- SCRUM-166 — Update the status of an equipment request
-- =============================================================================
-- "As a Technical Support Staff member, I want to record how far an equipment
-- request has got and identify what cannot be met, so that the coordinator can
-- judge whether the event is ready."
--
-- SCRUM-164 already created equipment_request.status (default under_review,
-- AC1) and equipment_request_line.unavailable for this story to write to
-- (dummy D-19). This adds what D-19 left to SCRUM-166:
--   AC2: who set the status and when;
--   AC4: the reason a request cannot be fulfilled, and the notification type
--        that tells the assigned coordinator;
-- and set_equipment_request_status, which saves a status and its unavailable
-- items together, so a reader never sees one without the other.
-- =============================================================================

-- AC2: "the new status, my identity and the timestamp are saved". Null until
-- a status is first set through the app: a request just raised is under review
-- with nobody's name on it (AC1). Restrict, as decided_by elsewhere.
alter table equipment_request
  add column status_set_by uuid references auth.users (id) on delete restrict,
  add column status_set_at timestamptz,
  -- AC4: "a reason is mandatory". Kept only while the request is unable to
  -- fulfil; the service refuses a blank one. 1000 characters, the same limit
  -- as the technical requirements.
  add column unable_reason text
    constraint equipment_request_unable_reason_length
      check (unable_reason is null or length(unable_reason) between 1 and 1000);

-- AC4: "the coordinator is notified". A new in-app notification type, sent to
-- the event's assigned coordinator. Widens the check constraint from
-- 20261018194905_notifications_assignment_types.sql, the same way.
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
    'equipment_unable_to_fulfil'
  ));

-- -----------------------------------------------------------------------------
-- set_equipment_request_status
--
-- Saves the status, who set it and when (AC2), which lines are unavailable
-- (AC3) and the reason (AC4) in one transaction. The rules - at least one
-- unavailable line for partially fulfilled, a reason for unable to fulfil -
-- are checked in the service first (src/domain/equipment-request/policy.ts);
-- this only refuses what the service cannot see: a request that does not
-- exist, or a line that is not on it.
--
-- Unavailable lines are kept only for partially fulfilled (the status AC3 is
-- about, and the one SCRUM-164's queue counts them for), and the reason only
-- for unable to fulfil, so a later status never shows an earlier one's items
-- or reason. Each save replaces the last: only the latest status, with who and
-- when, is kept.
--
-- Returns {outcome: 'saved', setAt} | {outcome: 'not_found'} |
-- {outcome: 'unknown_line'}.
-- -----------------------------------------------------------------------------
create or replace function set_equipment_request_status(
  p_event_request_id uuid,
  p_status text,
  p_unavailable_line_ids uuid[],
  p_reason text,
  p_set_by uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ids uuid[] := case when p_status = 'partially_fulfilled' then coalesce(p_unavailable_line_ids, '{}') else '{}' end;
  v_on_request integer;
  v_set_at timestamptz := now();
begin
  -- Lock the request, so two saves take turns and the second one wins whole.
  perform 1 from equipment_request where event_request_id = p_event_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select count(*) into v_on_request
  from equipment_request_line
  where event_request_id = p_event_request_id and id = any (v_ids);
  if v_on_request <> cardinality(array(select distinct unnest(v_ids))) then
    return jsonb_build_object('outcome', 'unknown_line');
  end if;

  update equipment_request_line
  set unavailable = (id = any (v_ids)), updated_at = v_set_at
  where event_request_id = p_event_request_id
    and unavailable is distinct from (id = any (v_ids));

  update equipment_request
  set status = p_status,
      status_set_by = p_set_by,
      status_set_at = v_set_at,
      unable_reason = case when p_status = 'unable_to_fulfil' then p_reason end,
      updated_at = v_set_at
  where event_request_id = p_event_request_id;

  return jsonb_build_object('outcome', 'saved', 'setAt', v_set_at);
end;
$$;

revoke all on function set_equipment_request_status(uuid, text, uuid[], text, uuid) from public, anon, authenticated;
grant execute on function set_equipment_request_status(uuid, text, uuid[], text, uuid) to service_role;
