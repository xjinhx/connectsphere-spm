-- =============================================================================
-- SCRUM-92 — Approve a request so planning can proceed (AC1)
-- =============================================================================
-- Step 2 of 2: record the decision.
--
-- AC1: "its status changes to Approved and the decision, decision maker and
-- timestamp are recorded". The column names are deliberately generic because
-- SCRUM-93 (reject) records the same three facts; that story widens the
-- decision check to include 'REJECTED'.
--
-- Approval commits ConnectSphere to nothing (customer clarification #80), so
-- there is no venue, equipment or registration state here.

alter table event_request
  add column decision text,
  -- Matches organiser_id, which also references auth.users. Restrict rather
  -- than cascade: deleting an account must not erase who approved what.
  add column decided_by uuid references auth.users (id) on delete restrict,
  add column decided_at timestamptz;

-- Only the outcome this story owns. SCRUM-93 extends this to 'REJECTED'.
alter table event_request
  add constraint event_request_decision_valid
  check (decision in ('APPROVED'));

-- One fact in three columns: all recorded together, or none of them.
alter table event_request
  add constraint event_request_decision_complete check (
    (decision is null and decided_by is null and decided_at is null)
    or (decision is not null and decided_by is not null and decided_at is not null)
  );

-- AC1 enforced rather than assumed: an approved request always carries its
-- decision.
alter table event_request
  add constraint event_request_approved_has_decision
  check (status <> 'APPROVED' or decision is not null);

-- SCRUM-82's constraint listed the statuses exhaustively: DRAFT with no
-- submission time, or SUBMITTED with one. APPROVED matched neither branch, so
-- approving would have been rejected by the database.
--
-- Restated as the rule underneath it: a request has no submission time exactly
-- when it is a draft. Identical behaviour today, and no later story that adds a
-- status (SCRUM-93's REJECTED, Event Status Management's CONFIRMED) has to edit
-- this constraint again.
alter table event_request
  drop constraint event_request_submitted_at_matches_status;

alter table event_request
  add constraint event_request_submitted_at_matches_status
  check ((status = 'DRAFT') = (submitted_at is null));
