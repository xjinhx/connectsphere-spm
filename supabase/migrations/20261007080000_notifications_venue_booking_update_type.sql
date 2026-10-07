-- =============================================================================
-- Venue booking notifications (SCRUM-148 AC2, SCRUM-149 AC1, SCRUM-151 AC2)
-- =============================================================================
-- One notification type for every venue-booking notification a coordinator
-- gets: a decision on their booking request (SCRUM-148, SCRUM-149) and a
-- confirmed booking affected by withdrawn availability (SCRUM-151). One type
-- rather than one per story, so the PRs that need it carry this same migration
-- and can merge in either order.
--
-- Widens the check constraint from
-- 20261005140000_notifications_coordinator_named_type.sql, the same way.
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
    'venue_booking_update'
  ));
