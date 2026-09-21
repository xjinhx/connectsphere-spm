-- =============================================================================
-- SCRUM-91 - Respond to a clarification request
-- =============================================================================
-- AC1: "I amend it and resubmit -> status returns to Submitted and the assigned
--      coordinator is notified."
-- AC2: "the original clarification note, my response and my amended values are
--      all retained with the event record."
-- AC3: "my request has been through two clarification rounds -> both rounds are
--      listed in order."
--
-- SCRUM-90 records a clarification in three columns on event_request
-- (clarification_note, clarification_requested_by, clarification_requested_at).
-- Those hold one note, so a second round overwrites the first and AC3 becomes
-- impossible to satisfy from them. AC1 and AC2 on their own could have been two
-- more columns (clarification_response, responded_at); AC3 is what makes this a
-- table.
--
-- Nothing SCRUM-90 created is altered or dropped. Its columns keep holding the
-- current clarification, its constraints and its set_clarification_requested_at
-- trigger are untouched, and its getClarificationView keeps working. Each round
-- is mirrored here by the trigger below, so the Coordinator's story needs no
-- change to make the Organiser's story possible.
-- =============================================================================

create table if not exists event_request_clarification_round (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: a round belongs to the event and goes with it. Same choice as
  -- event_request_coordinator_history (SCRUM-96).
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- AC3's "in order". An integer rather than ordering by requested_at: two
  -- rounds are ordered by which came first, and that is a fact about the
  -- exchange, not about clock precision.
  round_number integer not null check (round_number > 0),

  -- The Coordinator's half, copied from event_request as the round opens.
  -- Restrict on every account reference, as everywhere else: deleting an
  -- account must not quietly erase who asked for what.
  note text not null,
  requested_by uuid not null references auth.users (id) on delete restrict,
  requested_at timestamptz not null,

  -- The Organiser's half (AC1/AC2). Null until they answer: an open round is
  -- exactly `response is null`, which is also what the service filters on so
  -- one round cannot be answered twice.
  response text,
  responded_by uuid references auth.users (id) on delete restrict,
  responded_at timestamptz,

  -- One fact in three columns: answered, with who and when behind it, or not
  -- answered at all. Same shape as event_request_clarification_complete
  -- (SCRUM-90) and event_request_assignment_complete (SCRUM-94).
  constraint event_request_clarification_round_response_complete check (
    (response is null and responded_by is null and responded_at is null)
    or (response is not null and responded_by is not null and responded_at is not null)
  ),

  -- AC3 counts rounds, so a request cannot hold two round 2s. This is also the
  -- guard against a double insert if two clarifications were ever raised at the
  -- same instant: the second loses on the unique index rather than quietly
  -- creating a duplicate round.
  constraint event_request_clarification_round_unique unique (event_request_id, round_number)
);

-- Deliberately NOT a unique index on "one open round per request".
--
-- That was tried, and it is the wrong tool. More than one unanswered round is
-- not a state this story can produce - closing a round performs the status
-- change in the same statement (see the trigger below) - but it is a state
-- SCRUM-82's submit endpoint can still produce, because markEventRequestSubmitted
-- accepts clarification_requested and does not know rounds exist. An Organiser
-- who resubmits that way leaves a round open on a submitted request.
--
-- A unique index there would then refuse the *Coordinator's* next clarification
-- request, punishing them for what the Organiser's path did and breaking
-- SCRUM-90. Instead the read tolerates it: "the open round" is the newest
-- unanswered one (fetchOpenClarificationRound), so an older orphan is stepped
-- over rather than stalling every later response.
--
-- Narrowing SCRUM-82's submit to exclude clarification_requested, now that this
-- story owns that transition, would close the gap properly - but that is
-- another story's rule to change.

-- No separate index: the unique constraint above already indexes
-- (event_request_id, round_number), which is exactly how AC3 reads them.

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table event_request_clarification_round enable row level security;

-- -----------------------------------------------------------------------------
-- Open a round whenever a clarification is raised.
--
-- Keyed on the STATUS transition into clarification_requested, not on the note
-- text changing - a Coordinator rewording their question is still one round.
-- This is the same conclusion SCRUM-90 reached for set_clarification_requested_at
-- (commit abc128f, "re-stamp the clarification time on the status change, not
-- the note text"), and the two must agree or a round would carry a timestamp
-- from a different round.
--
-- AFTER rather than BEFORE, for two reasons:
--   1. It inserts into another table; it never modifies NEW, which is the only
--      thing BEFORE buys.
--   2. SCRUM-90's set_clarification_requested_at is a BEFORE trigger, and
--      triggers fire in name order - "record_clarification_round" sorts before
--      "set_clarification_requested_at", so a BEFORE version of this would run
--      first and copy a requested_at that had not been stamped yet.
--
-- Writing the round inside the same UPDATE as the status change means the two
-- succeed or fail together. supabase-js has no transactions, so an application
-- that wrote the round separately could leave a round with no clarification, or
-- a clarification with no round.
-- -----------------------------------------------------------------------------
create or replace function record_clarification_round() returns trigger language plpgsql as $$
begin
  if new.status = 'clarification_requested' and old.status is distinct from new.status then
    insert into event_request_clarification_round (
      event_request_id,
      round_number,
      note,
      requested_by,
      requested_at
    ) values (
      new.id,
      coalesce(
        (select max(round_number)
         from event_request_clarification_round
         where event_request_id = new.id),
        0
      ) + 1,
      new.clarification_note,
      new.clarification_requested_by,
      new.clarification_requested_at
    );
  end if;
  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

create trigger event_request_record_clarification_round
  after update of clarification_note, status on event_request
  for each row execute function record_clarification_round();

-- -----------------------------------------------------------------------------
-- One clock for the answer, too.
--
-- Same reasoning as set_clarification_requested_at (SCRUM-90), set_assigned_at
-- (SCRUM-94) and set_decided_at (SCRUM-92): a timestamp supplied by the caller
-- can be wrong or faked, and AC2 keeps this value for the Coordinator to read.
-- The service therefore writes `response` and `responded_by` only.
--
-- BEFORE, because it sets a column on the row being written. The
-- response-complete constraint is checked after this runs, so writing the two
-- columns the service knows about is enough to satisfy all three.
-- -----------------------------------------------------------------------------
create or replace function set_clarification_responded_at() returns trigger language plpgsql as $$
begin
  if new.response is not null and old.response is null then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

create trigger event_request_clarification_round_set_responded_at
  before update of response on event_request_clarification_round
  for each row execute function set_clarification_responded_at();

-- -----------------------------------------------------------------------------
-- AC1 — answering the open round is what returns the request to Submitted.
--
-- The two facts are one event: the Organiser answered, so the request is back
-- with the Coordinator. supabase-js has no transactions, so an application
-- doing them as two writes cannot make them succeed or fail together - and the
-- failure is not theoretical. Closing the round first and submitting second
-- leaves an answered round on a request still sitting in Clarification
-- Requested if the submit is refused, which SCRUM-82 AC2 does whenever a
-- mandatory field is incomplete: an ordinary mistake, not a rare fault. Doing
-- it the other way round leaves an open round on a submitted request, which is
-- the state the one-open-round index above describes.
--
-- Performing the status change here means there is one write, so neither state
-- can occur. The same reasoning as record_coordinator_reassignment (SCRUM-96),
-- which writes its history row inside the reassignment for exactly this reason.
--
-- Guarded on the current status rather than applied blindly: answering a round
-- on a request that is not awaiting one changes nothing, so a repair or a
-- backfill cannot move a request by accident.
--
-- What this does NOT do is decide whether the request may be submitted at all.
-- SCRUM-82 AC2's completeness rule (incompleteFields) is applied in the service
-- before the answer is written, so an incomplete request is refused and no
-- round is closed.
-- -----------------------------------------------------------------------------
create or replace function resubmit_on_clarification_response() returns trigger language plpgsql as $$
begin
  if new.response is not null and old.response is null then
    update event_request
      set status = 'submitted'
      where id = new.event_request_id
        and status = 'clarification_requested';
  end if;
  return null; -- AFTER trigger: the return value is ignored.
end;
$$;

-- AFTER, so responded_at has been stamped by the BEFORE trigger above and the
-- row is final before anything else reads it.
create trigger event_request_clarification_round_resubmit
  after update of response on event_request_clarification_round
  for each row execute function resubmit_on_clarification_response();

-- -----------------------------------------------------------------------------
-- Backfill: every clarification raised before this migration becomes round 1.
--
-- Without this, a request already sitting in Clarification Requested would have
-- a note on event_request and no round to show for it, and AC3 would list one
-- round fewer than actually happened. The response columns stay null because
-- there was nowhere to record a response until now - which is accurate, not a
-- gap.
-- -----------------------------------------------------------------------------
insert into event_request_clarification_round (
  event_request_id, round_number, note, requested_by, requested_at
)
select id, 1, clarification_note, clarification_requested_by, clarification_requested_at
from event_request
where clarification_note is not null
  and clarification_requested_by is not null
  and clarification_requested_at is not null
on conflict (event_request_id, round_number) do nothing;
