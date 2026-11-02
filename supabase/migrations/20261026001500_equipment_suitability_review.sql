-- =============================================================================
-- SCRUM-171 — Assess whether requested equipment is suitable for the event
-- =============================================================================
-- "As a Technical Support Staff member, I want to record whether each
-- requested item is suitable for what the event actually needs, so that we do
-- not reserve equipment that is available but wrong for the job."
--
-- AC1: each requested item can be marked suitable or not suitable, with why
--      (equipment_request_line.suitability, suitability_reason). Who marked it
--      and when are kept with it.
-- AC2: an item marked not suitable is an unmet requirement on the request, with
--      the reason. It is read from the same columns; nothing is added to or
--      taken from the available quantity (SCRUM-167 owns it, CL-50).
-- AC3: moved to SCRUM-176, outside Release 1 (CL-50): no suggested
--      alternative is stored.
-- AC4: completing the review marks the request ready to reserve when every
--      item is suitable and available for the commitment window
--      (equipment_request.ready_to_reserve). Decided in the service, from
--      SCRUM-167's checkEquipmentAvailability, when the review is completed;
--      later edits by the coordinator do not change it in Release 1 (PO, 26 Oct
--      2026; sending an amended request back for review is SCRUM-265, CL-56).
-- =============================================================================

-- AC1: the verdict on one requested item. Null until Technical Support Staff
-- mark it: a review can be completed with items unmarked, and the request is
-- then not ready (AC4).
alter table equipment_request_line
  add column suitability text
    constraint equipment_request_line_suitability_known
      check (suitability in ('suitable', 'not_suitable')),
  -- AC1: "record why". Required for not suitable (AC2 shows it as the reason),
  -- optional for suitable. Stored trimmed; the service refuses a blank one
  -- first, so this is the backstop.
  add column suitability_reason text
    constraint equipment_request_line_suitability_reason_length
      check (suitability_reason is null or length(suitability_reason) between 1 and 500),
  add column suitability_set_by uuid references auth.users (id) on delete restrict,
  add column suitability_set_at timestamptz,
  add constraint equipment_request_line_not_suitable_has_reason
    check (suitability is distinct from 'not_suitable' or suitability_reason is not null);

-- AC4: whether the completed review left the request ready to reserve, and who
-- completed it when. Null and false until a review is completed. Each
-- completion replaces the last.
alter table equipment_request
  add column ready_to_reserve boolean not null default false,
  add column review_completed_by uuid references auth.users (id) on delete restrict,
  add column review_completed_at timestamptz;

-- -----------------------------------------------------------------------------
-- save_equipment_suitability
--
-- AC1: saves every verdict in a review at once, so a reader never sees half a
-- save. p_verdicts is a JSON array of {lineId, suitability, reason}, one per
-- line being marked; suitability null clears a mark. The rules - a reason for
-- not suitable, none longer than 500 characters - are checked in the service
-- first (src/domain/equipment-request/policy.ts); this only refuses what the
-- service cannot see: a request that does not exist, or a line not on it.
--
-- Who and when are recorded only on the lines whose verdict or reason changed,
-- so saving the same review again does not rename who marked the rest. Only
-- the current verdict and reason are kept.
--
-- Returns {outcome: 'saved'} | {outcome: 'not_found'} | {outcome: 'unknown_line'}.
-- -----------------------------------------------------------------------------
create or replace function save_equipment_suitability(
  p_event_request_id uuid,
  p_verdicts jsonb,
  p_set_by uuid
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_set_at timestamptz := now();
  v_ids uuid[];
  v_on_request integer;
begin
  -- Lock the request, so two saves take turns and the second one wins whole.
  perform 1 from equipment_request where event_request_id = p_event_request_id for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  select array_agg(distinct (verdict ->> 'lineId')::uuid) into v_ids
  from jsonb_array_elements(p_verdicts) as verdict;

  select count(*) into v_on_request
  from equipment_request_line
  where event_request_id = p_event_request_id and id = any (coalesce(v_ids, '{}'));
  if v_on_request <> coalesce(cardinality(v_ids), 0) then
    return jsonb_build_object('outcome', 'unknown_line');
  end if;

  update equipment_request_line as line
  set suitability = verdict.suitability,
      suitability_reason = verdict.reason,
      suitability_set_by = p_set_by,
      suitability_set_at = v_set_at,
      updated_at = v_set_at
  from (
    select (value ->> 'lineId')::uuid as line_id,
           value ->> 'suitability' as suitability,
           value ->> 'reason' as reason
    from jsonb_array_elements(p_verdicts)
  ) as verdict
  where line.event_request_id = p_event_request_id
    and line.id = verdict.line_id
    and (line.suitability is distinct from verdict.suitability
         or line.suitability_reason is distinct from verdict.reason);

  return jsonb_build_object('outcome', 'saved');
end;
$$;

revoke all on function save_equipment_suitability(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function save_equipment_suitability(uuid, jsonb, uuid) to service_role;
