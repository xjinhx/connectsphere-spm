-- =============================================================================
-- SCRUM-187 — Request a change and track its outcome
-- =============================================================================
-- AC1: raising a change request creates it Pending, storing the current value
-- of each selected field alongside the proposed value, and notifies the
-- assigned coordinator.
-- AC6: each change request is listed with what was asked, its status, the
-- decision date and any reason given.
-- AC7: once approved, the event shows the new values (applied by SCRUM-190,
-- not here).
--
-- Field scope: 'field' is restricted to the subset AC1's field scope question
-- leaves unambiguous either way it is answered (Slack thread, 24 Oct 2026) -
-- date, times, expected attendance, venue requirements, equipment
-- requirements. Widening to the full event-request field set (or narrowing
-- out any of these) is a follow-up migration once the PO confirms; widening
-- the check constraint is the same pattern as
-- 20261007080000_notifications_venue_booking_update_type.sql.
--
-- decided_by/decided_at/decision_reason are written by SCRUM-190 (approve)
-- and SCRUM-191 (reject), not by this story — created here because a shared
-- table belongs to no single story (CLAUDE.md, "Dependencies on other
-- people's stories").
-- =============================================================================

create table change_request (
  id uuid primary key default gen_random_uuid(),
  event_request_id uuid not null references event_request (id) on delete restrict,
  organiser_id uuid not null references auth.users (id) on delete restrict,
  reason text not null,
  status text not null default 'pending'
    constraint change_request_status_known check (status in ('pending', 'approved', 'rejected')),
  -- Written by SCRUM-190/191, not this story.
  decided_by uuid references auth.users (id) on delete restrict,
  decided_at timestamptz,
  decision_reason text,
  created_at timestamptz not null default now()
);

create index change_request_event_request_id_idx on change_request (event_request_id);

create table change_request_field (
  id uuid primary key default gen_random_uuid(),
  change_request_id uuid not null references change_request (id) on delete cascade,
  field text not null
    constraint change_request_field_known check (field in (
      'proposedDate',
      'startTime',
      'endTime',
      'expectedAttendance',
      'roomLayout',
      'accessibilityRequired',
      'accessibilityFeatureIds',
      'accessibilityNotes',
      'preferredLocationId',
      'equipmentRequired',
      'equipmentItems',
      'technicalSupportNotes'
    )),
  -- jsonb holds whatever shape the field is: a string, number, boolean or
  -- array. current_value may be null (e.g. accessibilityNotes was unset);
  -- proposed_value is always supplied.
  current_value jsonb,
  proposed_value jsonb not null,
  constraint change_request_field_one_per_request unique (change_request_id, field)
);

-- AC1's notification to the assigned coordinator, through the existing
-- in-app mechanism (SCRUM-193/198), type 'change_requested'. Widening
-- notifications_type_known for it is 20261028090100_notifications_change_
-- requested.sql, which runs after this migration and after every other
-- story's own widening already on main - rebuilding the constraint here
-- would drop whichever of those already exist on a database this runs
-- against.
