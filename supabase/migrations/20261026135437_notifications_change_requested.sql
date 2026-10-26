-- =============================================================================
-- SCRUM-187 AC1 — keep 'change_requested' after merging main
-- =============================================================================
-- This branch's own 20261024090000_change_request.sql widened
-- notifications_type_known to add 'change_requested', but main's
-- 20261024103000_notifications_unable_to_fulfil_and_confirmed.sql (SCRUM-166/
-- SCRUM-102, written in parallel, same reasoning as its own header comment)
-- runs after it by filename and drops/recreates the constraint again without
-- it. Puts the full list back, with 'change_requested' included.
--
-- Any later migration that widens it again must keep every type below.
-- =============================================================================

alter table notifications
  drop constraint notifications_type_known;

alter table notifications
  add constraint notifications_type_known check (type in (
    'clarification_requested',
    'request_approved',
    'request_rejected',
    'coordinator_assigned',
    'coordinator_named',
    'venue_booking_update',
    'request_submitted',
    'coordinator_unassigned',
    'equipment_unable_to_fulfil',
    'event_confirmed',
    'change_requested'
  ));
