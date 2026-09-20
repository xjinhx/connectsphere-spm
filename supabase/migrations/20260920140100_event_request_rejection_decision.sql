-- =============================================================================
-- SCRUM-93 — Reject a request (AC4)
-- =============================================================================
-- Step 2 of 2: record the reason, and widen the decision this row can hold.
--
-- AC4: "its status changes to Rejected and the reason, decision maker and
-- timestamp are recorded". decision/decided_by/decided_at already exist
-- (SCRUM-92) and were deliberately made generic for this, so only the reason
-- is new here. set_decided_at() already fires on any write to decision, so
-- no new trigger is needed for 'rejected'.

alter table event_request
  add column rejection_reason text;

-- Was 'approved' only (SCRUM-92's own comment anticipated this widening).
alter table event_request
  drop constraint event_request_decision_valid;

alter table event_request
  add constraint event_request_decision_valid
  check (decision in ('approved', 'rejected'));

-- AC4/AC5 enforced rather than assumed: a reason exists exactly when the
-- decision is 'rejected'.
--
-- Written as a CASE rather than `(decision = 'rejected') = (rejection_reason
-- is not null)` on purpose: decision = 'rejected' evaluates to NULL, not
-- FALSE, when decision is NULL, and a CHECK only fails on an explicit FALSE
-- - so that equality would silently allow a reason to be recorded while
-- decision is still null. A simple CASE is null-safe by construction: NULL
-- never matches a WHEN, so it always falls through to ELSE.
alter table event_request
  add constraint event_request_rejection_reason_matches_decision
  check (
    case decision
      when 'rejected' then rejection_reason is not null
      else rejection_reason is null
    end
  );

-- Mirrors event_request_approved_has_decision: a rejected request always
-- carries its decision.
alter table event_request
  add constraint event_request_rejected_has_decision
  check (status <> 'rejected' or decision is not null);

-- event_request_submitted_at_matches_status ((status = 'draft') = (submitted_at
-- is null)) already covers 'rejected' correctly - a rejected request was
-- always submitted first, so no change needed, exactly as that migration's
-- own comment anticipated.
