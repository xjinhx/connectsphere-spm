-- =============================================================================
-- SCRUM-198 AC5 follow-up (PO clarification, 5 Oct 2026)
-- =============================================================================
-- AC5 asks for two separate notifications on assignment: the coordinator is
-- told they were assigned ('coordinator_assigned', already allowed), and the
-- organiser is told who the coordinator is ('coordinator_named', new).
--
-- Widens the check constraint added in 20260929090000_create_notifications.sql
-- to allow the new type. Does NOT add 'event_confirmed' here: that type still
-- has no call site (DUMMY(SCRUM-10) D-09, docs/dummies.md) and stays out of
-- the database until something actually writes it.
-- =============================================================================

alter table notifications
  drop constraint notifications_type_known;

alter table notifications
  add constraint notifications_type_known check (type in (
    'clarification_requested',
    'request_approved',
    'request_rejected',
    'coordinator_assigned',
    'coordinator_named'
  ));
