-- =============================================================================
-- SCRUM-191 — Reject a change request with a reason
-- =============================================================================
-- AC1: rejecting a pending change request sets status='rejected' and stores
-- the reason in decision_reason. decided_at is stamped by the database, not
-- the caller, mirroring set_decided_at() for event_request
-- (20260912161500_event_request_decided_at_trigger.sql) - one clock, so a
-- decision can never be backdated before its own request. The trigger fires
-- on either terminal status (approved or rejected), so SCRUM-190's own write
-- gets it too without a second trigger, same as the event_request one.
--
-- AC3: 'change_request_rejected' widens the notifications type check the
-- same way 20261024090000_change_request.sql widened it for
-- 'change_requested'. Full list kept per
-- 20261031153105_approve_change_request.sql's note: any later
-- migration that widens this constraint again must keep every type below.
-- =============================================================================

create or replace function set_change_request_decided_at() returns trigger language plpgsql as $$
begin
  if new.status in ('approved', 'rejected') and old.status = 'pending' then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger change_request_set_decided_at
  before update of status on change_request
  for each row execute function set_change_request_decided_at();

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
    'registration_withdrawn',
    'change_request_rejected'
  ));
