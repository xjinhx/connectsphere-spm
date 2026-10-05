-- =============================================================================
-- SCRUM-147 View the pending booking request queue: AC3
-- A booking request line can be decided
-- =============================================================================
-- AC3: "Given a request has been decided, when I open the queue, then it is no
--      longer listed."
--
-- SCRUM-142 created venue_booking_request_line with status 'pending' only, as
-- nothing could decide a line yet. Deciding one is SCRUM-148 (approve) and
-- SCRUM-149 (reject), neither built. "Shared tables belong to no single story"
-- (CLAUDE.md), so this story allows the two values those stories will write,
-- and nothing else. Status stays per line, as SCRUM-148 AC5 decides each line
-- on its own.
--
-- D-11 DUMMY(SCRUM-148): nothing writes 'approved' or 'rejected' yet; testers
--      set a line's status by hand in Studio (TC-147-05, TC-147-06). SCRUM-148
--      and SCRUM-149 write them for real and add whatever goes with a decision
--      (who decided, when, a rejection reason).
-- =============================================================================

alter table venue_booking_request_line
  drop constraint venue_booking_request_line_status_known;

alter table venue_booking_request_line
  add constraint venue_booking_request_line_status_known
  check (status in ('pending', 'approved', 'rejected'));
