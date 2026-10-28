-- =============================================================================
-- SCRUM-187 AC1 — widen notifications_type_known for 'change_requested'
-- =============================================================================
-- This branch's own 20261028090000_change_request.sql creates
-- change_request/change_request_field but does not touch
-- notifications_type_known, to avoid rebuilding the constraint ahead of
-- every other story's own widening already on main (review feedback, PR
-- #143). This migration runs last among this branch's three and adds
-- 'change_requested' to the full, current list (SCRUM-166/SCRUM-102's
-- 'equipment_unable_to_fulfil' included), so it matches whatever the
-- constraint already looks like on a database that has run every migration
-- up to this branch's merge-base.
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
