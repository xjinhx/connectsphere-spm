-- =============================================================================
-- SCRUM-164 — Queue of equipment requests awaiting review
-- =============================================================================
-- "As a Technical Support Staff member, I want a queue of equipment requests
-- awaiting my review, so that I can work through them before their events
-- approach."
--
-- AC3 and AC4 read an equipment request's status, and AC4 counts its
-- unavailable items. Neither existed: setting them is SCRUM-166 (Update the
-- status of an equipment request), which is not in this sprint. A shared table
-- belongs to no single story, so the columns are created here, shaped the way
-- SCRUM-166's ACs describe them, for SCRUM-166 to write to.
--
-- DUMMY(SCRUM-166) D-19: nothing in the app sets these yet. Testers set them by
-- hand (see docs/dummies.md, D-19). The queue reads them for real.
-- =============================================================================

-- SCRUM-166 AC1: a request that has just been raised is under review.
-- SCRUM-166 AC2: Technical Support Staff move it to partially fulfilled,
-- fulfilled or unable to fulfil. SCRUM-164 AC1, AC3: under review and partially
-- fulfilled are outstanding; fulfilled and unable to fulfil are resolved.
alter table equipment_request
  add column status text not null default 'under_review'
    constraint equipment_request_status_known
      check (status in ('under_review', 'partially_fulfilled', 'fulfilled', 'unable_to_fulfil'));

-- SCRUM-166 AC3: "I cannot save until every unavailable item is identified".
-- SCRUM-164 AC4: the queue shows how many items are still unavailable - each
-- line counted once, whatever its quantity (PO, 18 Oct 2026).
alter table equipment_request_line
  add column unavailable boolean not null default false;
