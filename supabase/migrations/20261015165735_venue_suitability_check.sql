-- =============================================================================
-- SCRUM-135 Check a selected venue against the event's requirements
-- =============================================================================
-- AC3: "Given a suitability check has been run and the event's requirements
--      have not changed since, when I reopen that venue against the event,
--      then the stored verdict, the unmet requirements and the time the check
--      was run are shown without re-running the check."
--
-- SCRUM-135 AC4 / SCRUM-136 AC5: a check can be for one of the event's booking
-- requests, at its venue, so a stored run also records which request it was for.
--
-- So a check is stored: one row per run, the verdict and every requirement
-- with its event and venue values (SCRUM-135 AC2), when it was run and by
-- whom, and the event's requirements as they were when it ran. Reopening reads
-- the latest run for the venue and compares those requirements with the
-- event's current ones: unchanged, the stored result is shown as it is; changed,
-- it is shown as out of date and the coordinator runs it again.
--
-- requirements and needs are jsonb because their shape is the application's
-- (SuitabilityResult and SuitabilityNeeds in src/domain/suitability/), which
-- grows as more requirements are checked (SCRUM-137) without a migration.
-- =============================================================================

create table if not exists venue_suitability_check (
  id uuid primary key default gen_random_uuid(),

  -- Cascade: a check is about this event and this venue, and goes with either.
  event_request_id uuid not null references event_request (id) on delete cascade,
  venue_id uuid not null references venues (id) on delete cascade,

  -- The booking request checked for; null when the venue was checked against
  -- the event itself. Cascade: a check for a request goes with it.
  venue_booking_request_id uuid references venue_booking_request (id) on delete cascade,

  verdict text not null
    constraint venue_suitability_check_verdict_known
      check (verdict in ('suitable', 'suitable_with_concerns', 'not_suitable')),

  -- AC2: each requirement checked, with the event's and the venue's values.
  requirements jsonb not null,

  -- AC3: the event's requirements the check used, to tell whether they have
  -- changed since.
  needs jsonb not null,

  -- Restrict, as decided_by elsewhere: deleting an account must not erase who
  -- did what.
  checked_by uuid not null references auth.users (id) on delete restrict,
  checked_at timestamptz not null default now()
);

-- AC3 reads the latest run of each venue for an event.
create index if not exists venue_suitability_check_event_venue_idx
  on venue_suitability_check (event_request_id, venue_id, checked_at desc);

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts.
alter table venue_suitability_check enable row level security;
