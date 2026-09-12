-- =============================================================================
-- SCRUM-77 — Choose the time slots the event needs
-- =============================================================================
-- The time_slots column was created as a placeholder by SCRUM-76. This adds
-- the rule that goes with it.
--
-- AC4 (customer clarification #50): AM, PM and NIGHT are the only slots that
-- exist. A row can hold one to three of them and nothing else - so nothing
-- crossing midnight can be stored, whatever the app sends.
--
-- No slot at all is stored as NULL, never as an empty array: "not yet chosen"
-- has one spelling, and AC3 (at least one slot to submit) is judged by the
-- completeness check in SCRUM-82, not here.

alter table event_request
  add constraint event_request_slots_valid check (
    time_slots is null
    or (
      -- coalesce, because array_length('{}') is NULL, not 0 - without it an
      -- empty array reads as "unknown" and satisfies the check.
      coalesce(array_length(time_slots, 1), 0) between 1 and 3
      and time_slots <@ array['AM', 'PM', 'NIGHT']::text[]
    )
  );
