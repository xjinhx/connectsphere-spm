-- =============================================================================
-- SCRUM-166 AC4 and SCRUM-102 AC6 — keep both notification types
-- =============================================================================
-- 20261023044500_equipment_request_status_update.sql (SCRUM-166) added
-- 'equipment_unable_to_fulfil' and 20261023121849_event_confirmed_notification.sql
-- (SCRUM-102) added 'event_confirmed', each widening the check constraint from
-- 20261018194905_notifications_assignment_types.sql. Both were written in
-- parallel, so the later one, run last, drops 'equipment_unable_to_fulfil'
-- again. This puts back the full list, with both types.
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
    'event_confirmed'
  ));
