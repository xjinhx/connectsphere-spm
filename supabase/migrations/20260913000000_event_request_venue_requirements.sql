-- =============================================================================
-- SCRUM-79 — State venue and accessibility requirements
-- =============================================================================
-- Adds the organiser's venue requirements to the table created by SCRUM-76.
-- Every column is nullable: like time_slots and expected_attendance, "not yet
-- answered" is a valid state of a draft. None of these is in the mandatory set
-- SCRUM-82 checks at submission - the Jira card does not ask for that.

-- AC1: one of the seven layouts the venue catalogue knows (SCRUM-118). The
-- list is the same as venue_layouts.layout, so a request can only ask for a
-- layout a venue could actually offer.
alter table event_request
  add column room_layout text
    check (room_layout in (
      'theatre',
      'classroom',
      'boardroom',
      'banquet',
      'u_shape',
      'cabaret',
      'standing'
    ));

-- AC2 and AC3: accessibility is an explicit answer, not a blank.
--   NULL  - not yet answered
--   false - none required (AC3: "explicitly answered rather than blank")
--   true  - required; the features chosen and any notes say what is needed
-- Notes can only exist alongside a "true" answer. The features live in the
-- link table below, so that half of the same rule is applied by the service.
alter table event_request
  add column accessibility_required boolean,
  add column accessibility_notes text
    check (accessibility_notes is null or btrim(accessibility_notes) <> ''),
  add constraint event_request_accessibility_notes_need_requirement check (
    accessibility_required is true or accessibility_notes is null
  );

-- AC2: the options the organiser selects from are the maintained accessibility
-- list (SCRUM-117), the same one venues are recorded against. Same shape as
-- venue_accessibility_features, so a coordinator can later match one to the
-- other directly.
create table event_request_accessibility_features (
  event_request_id uuid not null references event_request (id) on delete cascade,
  accessibility_feature_id uuid not null references accessibility_features (id) on delete restrict,
  primary key (event_request_id, accessibility_feature_id)
);

alter table event_request_accessibility_features enable row level security;

-- AC4: the preferred location, from the maintained list venues are recorded
-- against (SCRUM-116 AC1), so a coordinator can search on it directly. NULL is
-- "no preference": the card says a blank field is recorded as no preference,
-- so unlike accessibility there is no separate answer to store.
alter table event_request
  add column preferred_location_id uuid references locations (id) on delete restrict;
