-- =============================================================================
-- SCRUM-102 AC6 — the organiser is told their event is confirmed
-- =============================================================================
-- "Given an event is confirmed, when the confirmation is recorded, then the
-- Event Organiser receives a notification stating that the event is
-- confirmed." Moved here from SCRUM-198 AC4 (Change Log CL-09).
-- 20261005140000 left 'event_confirmed' out until something wrote it;
-- confirmEvent (domain/event-status/service.ts) now does.
--
-- Widens the check constraint from
-- 20261018194905_notifications_assignment_types.sql, the same way. Any later
-- migration that widens it again must keep this type.
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
    'event_confirmed'
  ));
