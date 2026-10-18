-- =============================================================================
-- Assignment notifications (SCRUM-197 AC1, AC3)
-- =============================================================================
-- Two new notification types:
--   - request_submitted: AC1, every Event Coordinator Lead (operations_manager)
--     is notified when an Event Organiser submits a request, because
--     assignment is their responsibility.
--   - coordinator_unassigned: AC3, the previous coordinator when an event is
--     reassigned away from them. The new coordinator reuses the existing
--     'coordinator_assigned' type (same meaning as SCRUM-94: "you now have
--     this event").
--
-- Widens the check constraint from
-- 20261007080000_notifications_venue_booking_update_type.sql, the same way.
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
    'coordinator_unassigned'
  ));
