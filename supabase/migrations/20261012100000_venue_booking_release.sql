-- =============================================================================
-- SCRUM-231 Release one venue booking without affecting the event's others
-- =============================================================================
-- AC1: "when I release one of them and give a reason, then that booking becomes
--      Released and its slots are available again."
--
-- A released booking keeps its row, so the event still shows what was given up
-- and why. Only its status changes, and everything that treats a venue as
-- committed already reads confirmed bookings only:
--   - venue_booking_one_per_slot, the partial unique index (SCRUM-148)
--   - SCRUM-154's request check, SCRUM-155's approval check, SCRUM-128 search,
--     SCRUM-123 calendar and getVenueCommitments (SCRUM-239)
--   - affected_booking_slot (SCRUM-151), so AC4's outstanding action closes
--   - update_venue's capacity check (SCRUM-120)
-- So a released booking frees its time everywhere, and none of them change.
--
-- AC2 and AC3 are the service's: only the event's assigned coordinator may
-- release, and the event and its other bookings are not touched.
--
-- Its own migration, after 20261008140500_time_model.sql, as agreed with the
-- time model lane on 9 Oct 2026.
-- =============================================================================

alter table venue_booking
  drop constraint venue_booking_status_known,
  add constraint venue_booking_status_known check (status in ('confirmed', 'released')),

  -- AC1: why the booking was released, by whom and when. Restrict, the same as
  -- decided_by on a booking request line: deleting an account must not erase
  -- who released what.
  add column release_reason text,
  add column released_by uuid references auth.users (id) on delete restrict,
  add column released_at timestamptz,

  -- A released booking always says why, who and when; a confirmed one never does.
  -- "release_reason is not null" is needed: length(trim(null)) is null, and a
  -- check that comes out null passes.
  add constraint venue_booking_release_recorded check (
    (status = 'confirmed' and release_reason is null and released_by is null and released_at is null)
    or (status = 'released' and release_reason is not null and length(trim(release_reason)) > 0
        and released_by is not null and released_at is not null)
  );
