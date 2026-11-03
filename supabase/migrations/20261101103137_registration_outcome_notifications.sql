-- =============================================================================
-- SCRUM-201 Notify attendees about registration outcomes
-- =============================================================================
-- Three new notification types, all sent to the Attendee whose registration
-- it is:
--   'registration_confirmed'     AC1: the registration was created;
--   'registration_refused_full'  AC3: refused because the event is full
--                                (CL-73: this notification is the record of
--                                the refusal; no registration row is stored);
--   'registration_withdrawn'     AC4: the withdrawal was confirmed.
--
-- Restates every type already allowed, as of
-- 20261031153105_approve_change_request.sql (the newest on main when this was
-- written). Leaving one out would silently block those notifications.
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
    'event_confirmed',
    'equipment_unable_to_fulfil',
    'change_requested',
    'event_cancelled',
    'change_request_approved',
    'arrangement_needs_review',
    'event_details_changed',
    'registration_confirmed',
    'registration_refused_full',
    'registration_withdrawn'
  ));
