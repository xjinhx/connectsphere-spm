-- =============================================================================
-- SCRUM-193 View my notifications in the application
-- SCRUM-198 Notify organisers about review outcomes
-- =============================================================================
-- One notification is one row: a message generated for one recipient, about
-- one event request, read or unread. SCRUM-193 lists and marks them read;
-- SCRUM-198 (and the dummies below) create them.
--
-- Replaces DUMMY(SCRUM-24) D-03, D-05, D-06 partially, D-08: those stories
-- recorded the minimum honest stand-in (an assignment/notice row with no
-- delivery) until this table existed. See docs/dummies.md - replacing them
-- is this story's job per the dummy register's rule.
--
-- No channel preference, no email queue: SCRUM-24's Release-1 scope (Twilio
-- SendGrid) is explicitly out of Sprint 2 (CLAUDE.md, "Notification"). This
-- is in-app only.
-- =============================================================================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),

  -- Who this is for. Restrict: deleting an account must not erase what they
  -- were told, same reasoning as venue_capacity_notice's coordinator_id.
  recipient_id uuid not null references auth.users (id) on delete restrict,

  -- What happened. An enum, not free text, so SCRUM-193's list can render an
  -- icon or link per type without parsing the message, and so future types
  -- (e.g. a booking decision) slot in without a migration touching existing
  -- rows.
  type text not null
    constraint notifications_type_known check (type in (
      'clarification_requested',
      'request_approved',
      'request_rejected',
      'coordinator_assigned'
    )),

  -- The event the notification is about. Cascade: a notification has no
  -- purpose once the event it refers to is gone.
  event_request_id uuid not null references event_request (id) on delete cascade,

  -- The full text shown in the list (SCRUM-193 AC1). Built once at creation
  -- time, not derived at read time, so a later status change on the event
  -- (or a since-changed coordinator name) never rewrites what the recipient
  -- was actually told.
  message text not null,

  -- Null means unread. SCRUM-193 AC3 sets this once, on open; it is never
  -- unset.
  read_at timestamptz,

  created_at timestamptz not null default now()
);

-- SCRUM-193 AC1: the recipient's own list, newest first.
create index if not exists notifications_recipient_idx
  on notifications (recipient_id, created_at desc);

-- SCRUM-193 AC2: the unread count is recipient_id filtered by read_at is null;
-- the index above already serves that filter efficiently without a second one.

alter table notifications enable row level security;

-- Deny-all backstop, the same as every other table: server code reads and
-- writes through the service-role client and decides access in policy.ts
-- (a recipient sees only their own notifications - SCRUM-193's implicit
-- access rule, matching the narrower "connected to the thing" pattern
-- CLAUDE.md's identity/policy.ts comment describes for other reads).
