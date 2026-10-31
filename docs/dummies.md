# Dummy register

Every dummy in the codebase, active or replaced. **Read this before starting a
story**, and update it in the same PR that adds, changes or replaces a dummy.
The rules behind it are in `CLAUDE.md`, under "Dependencies on other people's
stories".

## What counts as a dummy

Something in the code that **must change when another story lands**. There are
three kinds:

| Kind | What it is | Example below |
|---|---|---|
| Stand-in code | A fake version of another story's unfinished function | D-04: a function that always returns an empty list |
| Loosened rule | A real rule deliberately relaxed until another story lands | D-01: an organisation is allowed to be empty |
| Out-of-sprint stand-in | The minimum honest version of a feature that isn't in this sprint | D-03: a "notification" that is only the stored record |

**Not a dummy:** a column one story creates early for another (e.g.
`time_slots`, created by SCRUM-76 for SCRUM-77). It's real, and there's
nothing to swap.

## How to use it

- **Adding one.** Mark every place it lives with
  `// DUMMY(SCRUM-<key>) D-<nn>: <what is faked>` — the key is the story it
  waits on, or the epic's key if no story exists yet. Waiting on more than one
  story? One marker line per key, so a search for any of them finds it. Then
  add an entry below with the next number, and put the `uses-dummy` label on
  your Jira ticket.
- **Starting a story.** Run `git grep "DUMMY(SCRUM-<your key>"` and search this
  file for your key. Replacing those dummies is part of your story.
- **Replacing one.** Follow its "To replace" steps, re-run the tests of the
  story that added it, remove its markers, and set **Status** to Replaced with
  the PR number. Never delete an entry — replaced entries are the history.

**Status** is one of Active, Partly replaced, Replaced.

**Does a test against a dummy count?** Only if it actually runs the behaviour.
D-02's check really shows "nothing is committed", so it counts. D-04's check
has no bookings to find, so it proves nothing, and that AC stays in Merged -
Pending Verification.

D-01 to D-05 existed before the `DUMMY(...)` marker did. D-02 to D-05 have
been switched to it; D-01 still carries its original comments, and its owners
switch them the next time they edit those files.

---

### D-01 — An event request's client organisation may be empty

- **Kind:** Loosened rule
- **Added by:** SCRUM-76 — commit `bee2e54` (PR #9)
- **Waiting on:** ~~SCRUM-88 Show client organisation on the assigned-events queue~~ — resolved (PR #54)
- **Where:**
  - ~~`src/domain/assignment/service.ts` — `AssignedEvent` carried no~~
    ~~client organisation field~~ — resolved (PR #54): now carries
    `clientOrganisation`
  - ~~`src/app/assigned-events/page.tsx` — no client organisation~~
    ~~column~~ — resolved (PR #54): column added
- **To replace:** ~~once SCRUM-88 adds a client organisation column to the
  assigned-events queue, have `AssignedEvent` carry `client_organisation_id`/
  `name` and render it on that page; re-test SCRUM-88's own ACs.~~ Done (PR #54).
- **Status:** Replaced (SCRUM-88, PR #54). SCRUM-203 (`client_organisations` table) and
  SCRUM-204 (linking an organiser to one, PR #22, merged into main) resolved
  the event-request side: `currentActor.ts` now reads the actor's real
  `clientOrganisation` (`null` only for internal staff or an organiser not
  yet linked by a Coordinator — a real, permanent state per SCRUM-204 AC2,
  not a gap), `event_request.client_organisation_id` is a real nullable FK,
  and SCRUM-76's create flow (AC1) now pre-fills the organisation correctly
  for a linked organiser. The original "refuse a missing organisation" /
  "restore NOT NULL" plan below no longer applies — SCRUM-204 does not
  guarantee every organiser is linked, so enforcing non-null would wrongly
  block an organiser a Coordinator hasn't linked yet. What remains is the
  assigned-events display gap (SCRUM-88), unrelated to event-request
  creation.

  SCRUM-88 has since added the client organisation column to the
  assigned-events queue (`AssignedEvent.clientOrganisation`, rendered on
  `assigned-events/page.tsx`, shown as "-" for an unlinked organiser).
  Both locations listed above are resolved. All three of SCRUM-88's ACs
  are manually verified end to end. D-01 is fully replaced.

### D-02 — "Nothing is committed" is hardcoded when a request is approved

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-92 — commit `b7e48a9` (PR #23)
- **Waiting on:** SCRUM-148 Approve a booking request (venue) · SCRUM-21
  Equipment Reservation · SCRUM-22 Attendee Registration
- **Where:** `src/domain/review/policy.ts` — `NO_COMMITMENTS`, every flag
  asserted `false`
- **To replace:** derive the venue, equipment and registration flags from
  confirmed bookings, reservations and registrations; re-run US-7.3-TC05 and
  TC06 (SCRUM-92 AC2 and AC3). Each flag can be replaced separately, as its
  epic lands.
- **Status:** Partly replaced. **Venue:** replaced by SCRUM-148 (branch
  `venue-booking-approval`). `getApprovalView` reads the event's confirmed
  bookings (`commitmentsFor`), and once one exists the statement says "A venue
  is booked…" in place of "No venue…". US-7.3-TC05 and TC06 were re-run in
  `approval-view.test.ts`, and the SCRUM-148 marker was removed.
  **Equipment and registration:** still asserted `false`, waiting on SCRUM-21
  and SCRUM-22.

### D-03 — A coordinator's "notification" is only the recorded assignment

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-94 — commit `bb942af` (PR #28)
- **Waiting on:** ~~SCRUM-24 Notification System~~ — resolved (SCRUM-193/198)
- **Where:** ~~`src/domain/assignment/service.ts` — `assignCoordinator()`~~
  — resolved: now calls `createNotification` (`coordinator_assigned`)
  straight after the assignment is recorded, best-effort via
  `notifyBestEffort` so a notification failure cannot undo the assignment.
- **To replace:** ~~notify the assigned coordinator from~~
  ~~`assignCoordinator()`...~~ Done. Re-run US-8.1-TC02 (SCRUM-94 AC1)
  against the notification now created.
- **Status:** Replaced (SCRUM-193/198).

### D-04 — Confirmed bookings are a stand-in table filled by hand

- **Kind:** Stand-in code (a shared table created early, with nothing yet
  writing to it)
- **Added by:** SCRUM-120 — commit `80dd30e` (PR #13), as an always-empty
  list; reworked into the `venue_booking` table by SCRUM-120 AC2 to AC4
  (branch `venue-capacity-cut-warning`)
- **Waiting on:** SCRUM-148 Approve a booking request
- **Where:**
  - `supabase/migrations/20260924170000_venue_capacity_cut_affected_bookings.sql`
    — the `venue_booking` table (`DUMMY(SCRUM-148) D-04`), and the check in
    `update_venue`
  - `src/lib/supabase/venues.ts` — `fetchConfirmedFutureBookings()`
    (`DUMMY(SCRUM-148) D-04`)
  - `src/domain/venues/service.ts` — `findAffectedFutureBookings()`
    (`DUMMY(SCRUM-148) D-04`)
  - `supabase/migrations/20261007120000_venue_unavailable_slot_affected_bookings.sql`
    — the `affected_booking_slot` view (`DUMMY(SCRUM-148) D-04`), added by
    SCRUM-151 AC2: a confirmed booking on a slot Venue Staff have made
    unavailable
  - Read by SCRUM-128 too: `src/lib/supabase/venues.ts` —
    `fetchConfirmedBookingsOn()`, and `src/domain/venues/service.ts` —
    `searchVenues()` (markers removed, see Status)
- **What is real and what is faked:** the capacity check, the list of affected
  bookings, the confirm step and the refusal inside the save are SCRUM-120's
  real code. Only the bookings themselves are faked: nothing in Sprint 1
  creates a booking, so a tester adds `venue_booking` rows by hand (below).
  That makes AC2 and AC3 testable against real rows, where the old empty list
  had nothing to run against.
- **To test by hand:** in Studio (`http://localhost:54323`), pick a submitted
  event request with a future `proposed_date` and an `expected_attendance`
  (say 100), then run:
  ```sql
  insert into venue_booking (venue_id, event_request_id)
  values ('<venue id>', '<event request id>');
  ```
  Edit the venue and set its maximum capacity to 99 (AC2: the booking is
  listed and must be confirmed) or to 100 (AC3: saves with no warning).
- **Note for SCRUM-148:** a booking has no date or time slot of its own. It
  takes both from its event request (`proposed_date`, `time_slots`), and
  "future" is judged on the Singapore date (`todayInSingapore`). If SCRUM-148
  gives a booking its own date or slot, `update_venue`,
  `fetchConfirmedFutureBookings()`, `fetchConfirmedBookingsOn()` (SCRUM-128)
  and the `affected_booking_slot` view (SCRUM-151) must read that instead.
  (Raised in review of PR #61.)
- **To replace:** SCRUM-148's approval flow writes `venue_booking` rows (and
  may widen `status` beyond `'confirmed'`). Nothing in SCRUM-120 changes;
  re-run `tests/integration/venue-capacity-cut.test.ts` and SCRUM-120 AC2 and
  AC3 by hand against a booking made through that flow. Do the same for
  SCRUM-128 (`tests/integration/venue-search.test.ts`, AC2 and AC3) and
  SCRUM-151 (`tests/integration/venue-unavailable-slots.test.ts`, AC2 and AC3).
  Then remove the markers.
- **Status:** Replaced (SCRUM-148, branch `venue-booking-approval`).
  `decide_venue_booking_request` writes one booking per venue, date and slot,
  with its own `date` and `slot`, and `venue_booking_one_per_slot` refuses a
  second confirmed booking of a slot
  (`20261007090000_venue_booking_decision.sql`). The hand-made stand-in rows
  are removed by that migration. `update_venue` and
  `fetchConfirmedFutureBookings()` now judge "future" on the booking's own
  date and count an event once. `venue-capacity-cut.test.ts` passes, its setup
  rows now carrying a date and slot. The TypeScript markers are removed; the
  comments in the 20260924170000 migration stay as history rather than editing
  an applied migration. SCRUM-128's search (`fetchConfirmedBookingsOn()`,
  `searchVenues()`) now reads each booking's own date and slot;
  `venue-search.test.ts` passes, its setup rows carrying a date and slot.
  SCRUM-151's `affected_booking_slot` view
  (`20261007120000_venue_unavailable_slot_affected_bookings.sql`) also reads
  each booking's own date and slot, switched by SCRUM-151, which merged after
  SCRUM-148; `venue-unavailable-slots.test.ts` passes, its setup rows carrying
  a date and slot. Re-check SCRUM-151 AC2 and AC3 by hand against a booking
  approved through SCRUM-148 (TC-151-05, TC-151-08).
  SCRUM-123's venue calendar, merged after SCRUM-148, reads bookings through
  `listVenueBookings()` (`src/domain/venues/calendar.ts`), so it uses each
  booking's own date and slot and SCRUM-148 AC3/AC4's event visibility; no
  markers left. `tests/integration/venue-calendar.test.ts` passes.

### D-05 — A capacity cut's "notification" is only a stored notice

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-120 — commit `80dd30e` (PR #13), as a marker only;
  implemented as the `venue_capacity_notice` record by SCRUM-120 AC4 (branch
  `venue-capacity-cut-warning`)
- **Waiting on:** SCRUM-24 Notification System
- **Where:**
  `supabase/migrations/20260924170000_venue_capacity_cut_affected_bookings.sql`
  — the `venue_capacity_notice` table and the insert in `update_venue`
  (`DUMMY(SCRUM-24) D-05`)
- **What it does:** a confirmed cut writes one `venue_capacity_notice` row per
  affected event, addressed to its coordinator (`coordinator_id`, null when
  none is assigned yet), holding the old and new capacity and the event's
  expected attendance. It is written in the same transaction as the cut. This
  is the minimum honest notification CLAUDE.md asks for, the same as D-03
  (SCRUM-94) and D-06 (SCRUM-96). Since SCRUM-230
  (`20261014145622_capacity_cut_by_booking_attendance.sql`), the attendance is
  the booking's own where its request has one: the largest among the event's
  bookings over the new capacity.
- **To replace:** send each notice to its coordinator using SCRUM-24's
  mechanism; the row already holds everything the message needs. Re-run
  SCRUM-120 AC4.
- **Status:** Active

### D-06 — Neither coordinator is notified when an event is reassigned

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-96 — commit `b81d88c` (PR #29)
- **Waiting on:** SCRUM-24 Notification System
- **Where:** `src/domain/assignment/service.ts` — `reassignCoordinator()`
- **To replace:** notify both the previous and the new coordinator from
  `reassignCoordinator()`, straight after the reassignment is recorded, using
  SCRUM-24's mechanism; the `event_request_coordinator_history` row written by
  the same update holds who, from whom, to whom and when. Re-run US-8.1-TC03
  (SCRUM-96 AC1).
- **Status:** Replaced (SCRUM-197). `reassignCoordinator()` now notifies both
  coordinators with `notifyBestEffort()` straight after the reassignment write
  succeeds: the previous coordinator gets a new type, `coordinator_unassigned`
  ("You are no longer the coordinator for …"), and the new coordinator reuses
  `coordinator_assigned` (SCRUM-94's own type — same meaning, "you now have
  this event"). Both types are widened into the check constraint by
  `20261018060000_notifications_assignment_types.sql`. The event's reference
  and name are read with a separate `fetchEventRequestById()` call, since
  `EventAssignmentRow` carries neither. The marker is removed. Re-checked with
  US-8.1-TC03 (SCRUM-96 AC1) in `tests/integration/reassign-coordinator.test.ts`
  — now also asserts a `coordinator_unassigned` row for the previous
  coordinator and a `coordinator_assigned` row for the new one.

### D-08 — The coordinator isn't notified when a request is resubmitted

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-91 — PR #42
- **Waiting on:** SCRUM-24 Notification System
- **Where:** `src/domain/clarification/service.ts` — `respondToClarification()`
- **To replace:** notify the assigned coordinator from
  `respondToClarification()`, straight after the round is closed, using
  SCRUM-24's mechanism; the outcome already carries `coordinatorId`, and the
  closed round holds the note that was asked, the answer and when it was given.
  Re-run US-7.2-TC04 (SCRUM-91 AC1).
- **Status:** Active

### D-09 — Unavailable slots are a stand-in table filled by hand

- **Kind:** Stand-in code (a shared table created early, with nothing yet
  writing to it)
- **Added by:** SCRUM-128 Search venues by date and slot — branch
  `venue-search-by-date-and-slot`
- **Waiting on:** SCRUM-151 Withdraw venue availability when circumstances
  change (its AC1 records the unavailable slots and their reason)
- **Where:**
  - `supabase/migrations/20261001090000_venue_unavailable_slot.sql` — the
    `venue_unavailable_slot` table (`DUMMY(SCRUM-151) D-09`)
  - `src/lib/supabase/venues.ts` — `fetchUnavailableSlotsOn()`
    (`DUMMY(SCRUM-151) D-09`)
  - `src/domain/venues/service.ts` — `searchVenues()`
    (`DUMMY(SCRUM-151) D-09`)
- **What is real and what is faked:** the search, and its rule that a slot
  recorded as unavailable excludes the venue (SCRUM-128 AC4), are real.
  SCRUM-154 reads the same rows to refuse a booking request for an unavailable
  slot (its AC4), which is real in the same way. Only
  the recording is faked: nothing yet lets Venue Staff withdraw a slot, so a
  tester adds rows by hand. That makes AC4 testable against real rows.
  "Shared tables belong to no single story" (`CLAUDE.md`), so the table is the
  smallest one SCRUM-151 needs anyway: venue, date, slot, and a required reason
  (customer clarification #54). SCRUM-123 AC7 reads the same rows to show a
  slot as Blocked with its reason.
- **To test by hand:** in Studio (`http://localhost:54323`), pick a venue that
  runs the Night slot and a date, then run:
  ```sql
  insert into venue_unavailable_slot (venue_id, date, slot, reason)
  values ('<venue id>', '<YYYY-MM-DD>', 'night', 'Annual maintenance');
  ```
  Search that date for Night (AC4: the venue is gone), then for AM (it's back).
- **To replace:** SCRUM-151's flow writes `venue_unavailable_slot` rows,
  widening the table if it needs to — for example, who recorded it, or a
  reason category: the customer's Week 7 change W7-2 names maintenance,
  equipment failure, renovation, safety and other, where `reason` here is free
  text. Widen this table rather than add a second one. Nothing in SCRUM-128
  changes if the four columns stay; re-run
  `tests/integration/venue-search.test.ts` and SCRUM-128 AC4 by hand against a
  slot withdrawn through that flow, and SCRUM-154 AC4 and AC5
  (`tests/integration/submit-venue-booking-request.test.ts`), then remove the
  markers.
- **Status:** Replaced (SCRUM-151, branch `venue-unavailable-slots`). SCRUM-151
  AC1 writes `venue_unavailable_slot` rows through
  `POST /api/venues/[id]/unavailable-slots`. It kept the four columns and added
  `recorded_by` (`20261007110000_venue_unavailable_slot.sql`), so nothing in
  SCRUM-128 changed. `venue-search.test.ts` passes against the merged tables.
  SCRUM-128 AC4 by hand is TC-151-02: search a date and slot withdrawn through
  SCRUM-151. The TypeScript
  markers are removed; the comments in the 20261001090000 migration stay as
  history rather than editing an applied migration.
  SCRUM-123's venue calendar, merged after SCRUM-151, reads the same table
  (`fetchUnavailableSlotsBetween()`); no markers left.
  `tests/integration/venue-calendar.test.ts` passes.

### D-10 — Planning is added and reached without SCRUM-101

- **Kind:** Stand-in code
- **Added by:** SCRUM-103 — PR #69
- **Waiting on:** SCRUM-101 Move an event through its statuses as work is done
- **Where:**
  - `supabase/migrations/20260928120000_event_request_lifecycle_statuses.sql`
    — adds `'planning'` with `IF NOT EXISTS`. SCRUM-101's own migration
    (`20260927090100_event_request_planning_status.sql`, branch
    `move-event-status`) adds the same value and runs first on a fresh reset.
  - `src/domain/event-request/schema.ts` — `'planning'` in
    `EventRequestStatusEnum` and its label.
  - `tests/integration/event-status-transitions.test.ts` —
    `createConfirmedRequest()` moves approved -> planning with
    `changeEventStatus`, where the app will use SCRUM-101's action.
  - `tests/integration/coordinator-my-events.test.ts` (SCRUM-97) —
    `createAssignedEvent()` does the same for its Planning and Confirmed events.
  - Manual testing: TC-103-09 (and the SCRUM-97/99 cases that need a Planning
    or Confirmed event) set Planning with the SCRUM-103 harness,
    `tests/manual/change-event-status.test.ts`.
- **To replace:** once SCRUM-101 is on main: keep a single `'planning'` in
  `EventRequestStatusEnum`, `EVENT_REQUEST_STATUS_LABELS` and the badge
  (merge whichever copy arrives second); leave the `IF NOT EXISTS` line in the
  migration (it is then a no-op, and removing it would change an applied
  migration); switch `createConfirmedRequest()` and `createAssignedEvent()` to
  SCRUM-101's approved -> planning function and set Planning through its
  action in the manual tests. Re-run TC-103-01 to 09 (SCRUM-103 AC1-AC4) and
  TC-97-02 / TC-97-04 (SCRUM-97 AC1).
- **Status:** Replaced (SCRUM-101, branch `move-event-status`). A single
  `'planning'` is in the enum, labels and badge; `createConfirmedRequest()` and
  `createAssignedEvent()` use `enterPlanning`; the markers are removed.
  SCRUM-101's migration was renamed to
  `20260927090100_event_request_planning_status.sql` (it shared a version with
  `20260927090000_venue_setup_turnaround_slots.sql`, which fails
  `supabase start`), and now uses `add value if not exists 'planning'` so it
  also runs on a database that already has the value from SCRUM-103's
  migration. TC-103-01 to 09 and TC-97-02 / TC-97-04 were re-run by hand on
  06/10/26 and all passed, with Planning reached by raising a venue booking
  request in the Request a venue form (the trigger in
  `20261006100000_event_request_enter_planning_on_booking_request.sql`)
  instead of the SCRUM-103 harness. Confirmed is still set with the harness
  (`tests/manual/change-event-status.test.ts`), as there is no Confirm action
  until Sprint 3. Results are in the SCRUM-101 Jira comment:
  https://scrumers-is212.atlassian.net/browse/SCRUM-101?focusedCommentId=10292

### D-11 — Approved -> Planning is not yet triggered automatically

- **Kind:** Stand-in code (the rule and the write both exist for real; only
  the automatic trigger is missing)
- **Added by:** SCRUM-101 — this commit
- **Waiting on:** SCRUM-142 Submit a venue booking request for an event
  (branch `submit-venue-booking-req`), for its `venue_booking_request`
  table to exist so a trigger can reference it
- **Where:** `src/domain/event-status/policy.ts` (`canEnterPlanning`) and
  `src/domain/event-status/service.ts` (`enterPlanning`)
- **What is real and what is faked:** the transition rule (AC3/AC4) and the
  database write are both real and integration-tested against a real
  database (`tests/integration/enter-planning.test.ts`) — calling
  `enterPlanning(id)` directly genuinely moves an Approved event to
  Planning. What's missing is the automatic connection: nothing currently
  calls `enterPlanning()` when a venue booking request is actually raised,
  because SCRUM-142's `venue_booking_request` table doesn't exist on this
  branch or on `main` yet. This is deliberately not SCRUM-142's problem to
  carry — that ticket's own ACs only cover creating the request, not the
  event reacting to it — so the connection is tracked here instead.
- **To replace:** once SCRUM-142 merges to `main` and this branch merges
  `main` in, add a database trigger on `venue_booking_request` (after
  insert) that calls into the Planning transition when the parent event is
  Approved, the same pattern as `set_decided_at`/
  `set_clarification_requested_at` elsewhere in this codebase — rather than
  having SCRUM-142's application code call `enterPlanning()` directly,
  which would require that ticket's code to know this one exists. Re-run
  `enter-planning.test.ts`, and add a test that actually inserting a
  `venue_booking_request` row fires the trigger.
- **Status:** Replaced (SCRUM-101). SCRUM-142 landed in PR #70. The trigger is
  `supabase/migrations/20261006100000_event_request_enter_planning_on_booking_request.sql`,
  tested in `tests/integration/submit-venue-booking-request.test.ts` (an
  Approved event becomes Planning on its first request, stays Planning on a
  further one, and is untouched when the request is refused).

### D-12 — Releasing an affected booking is done by hand

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-151 AC3 — branch `venue-unavailable-slots`
- **Waiting on:** SCRUM-231 Release an affected booking (Sprint 3); its AC4
  closes the outstanding action. "Replace" is SCRUM-229. SCRUM-105 (cancel an
  event) and SCRUM-153 (postpone one) also release bookings and should reuse
  the same release. (The markers first used the epic key SCRUM-17, before
  SCRUM-231 existed.)
- **Where:** `src/domain/availability/service.ts` — `listAffectedBookings()`;
  `src/components/venue/AffectedBookingsNotice.tsx` (both
  `DUMMY(SCRUM-231) D-12`)
- **What is real and what is faked:** the outstanding action is real. Each
  affected booking is listed on the coordinator's event page for as long as it
  is still confirmed on an unavailable slot, and drops off once it is not.
  Only the release itself is missing: the page states the action instead of
  offering a button. To see an entry clear, a tester removes the booking by
  hand (the stand-in's status check only allows `'confirmed'`):
  ```sql
  delete from venue_booking where event_request_id = '<event id>' and venue_id = '<venue id>';
  ```
  "Replaced" is tested as booking the event at another venue, then removing
  the old booking.
- **To replace:** SCRUM-231 adds the release action (with SCRUM-148, a
  released status). `listAffectedBookings()` does not change, because it only
  lists confirmed bookings. Add the action beside each entry in
  `AffectedBookingsNotice`, re-run SCRUM-151 AC3, then remove the markers.
- **Status:** Replaced (SCRUM-231, branch `venue-booking-release`). A booking
  now has a `released` status with its reason, who released it and when
  (`20261012100000_venue_booking_release.sql`). The event's assigned
  coordinator releases it from the event page's Venue bookings list
  (`releaseVenueBooking()`, `POST /api/venue-bookings/[id]/release`).
  `listAffectedBookings()` did not change: a released booking is no longer
  confirmed, so its entry clears. The release sits in the bookings list rather
  than beside each entry, and the notice points there, so there is one Release
  button per booking. The markers are removed. Re-check with TC-151-09
  (release) and TC-151-10 (book elsewhere, then release the old booking), both
  through the app.

### D-13 — A booking decision's "notification" is only the recorded decision

- **Kind:** Stand-in code (SCRUM-193's in-app notifications are in this sprint
  but not on main yet)
- **Added by:** SCRUM-148 AC2 — branch `venue-booking-approval`. Also used by
  SCRUM-149 AC1 (branch `venue-booking-rejection`): a rejection is the same
  decision.
- **Waiting on:** SCRUM-193 View my notifications in the application
- **Where:** `src/domain/venue-booking/service.ts` —
  `decideVenueBookingRequest()` (`DUMMY(SCRUM-193) D-13`)
- **What it does:** "the assigned Event Coordinator is notified" (SCRUM-148
  AC2) and "the coordinator is notified" (SCRUM-149 AC1) are the decision
  recorded on each line (status, `decided_by`, `decided_at`, reason), returned
  with the event's `coordinatorId`. The same minimum honest notification as
  D-03 (SCRUM-94).
- **To replace:** once SCRUM-193's notifications exist, create one for the
  event's coordinator from `decideVenueBookingRequest()` after the decision is
  saved (it would need a booking-decision type; 193's list has none yet).
  Re-run SCRUM-148 AC2 and SCRUM-149 AC1.
- **Status:** Replaced (SCRUM-148, before merging: SCRUM-193 merged first, PR
  #75). `decideVenueBookingRequest()` now notifies the event's coordinator with
  `notifyBestEffort()`, type `venue_booking_update`
  (`20261007080000_notifications_venue_booking_update_type.sql`), giving the
  outcome and each rejected line's reason. The marker is removed. Re-check
  with TC-148-02 and TC-149-01, reading the notification as the coordinator.

### D-14 — An affected booking's "notification" is only a stored notice

- **Kind:** Stand-in code (SCRUM-193's in-app notification list is in this
  sprint but not built yet)
- **Added by:** SCRUM-151 AC2 — branch `venue-unavailable-slots`. First
  numbered D-11; renumbered when SCRUM-101 took D-11 on main (D-13 is
  SCRUM-148's).
- **Waiting on:** SCRUM-193 View my notifications in the application
- **Where:**
  `supabase/migrations/20261007120000_venue_unavailable_slot_affected_bookings.sql`
  — the `venue_unavailability_notice` table and the insert in
  `mark_slots_unavailable` (`DUMMY(SCRUM-193) D-14`);
  `src/domain/availability/service.ts` — `markSlotsUnavailable()`
  (`DUMMY(SCRUM-193) D-14`)
- **What it does:** marking slots unavailable writes one
  `venue_unavailability_notice` row per affected booking of an upcoming event,
  addressed to the event's assigned coordinator, holding the date, the
  withdrawn slots the event uses and the reason. It is written in the same
  transaction as the slots. No coordinator assigned means no notice; the
  booking still shows as affected (`affected_booking_slot`). The same minimum
  honest notification as D-05 (SCRUM-120).
- **To replace:** once SCRUM-193's notifications exist, write each notice as
  one of them (or have SCRUM-193 list these rows); the row already holds
  everything the message needs. Re-run SCRUM-151 AC2.
- **Status:** Replaced (SCRUM-151, before merging: SCRUM-193 merged first, PR
  #75). After the save, `markSlotsUnavailable()` sends each notice to its
  coordinator with `notifyBestEffort()`, type `venue_booking_update`
  (`20261007080000_notifications_venue_booking_update_type.sql`), naming the
  withdrawn slots and the reason. The notice rows stay as the record of who
  was told what. The markers are removed. Re-check with TC-151-05 and
  TC-151-06, reading the notification as the coordinator.

### D-15 — Releasing or cancelling a booking is done by hand

- **Kind:** Out-of-sprint stand-in (no story in this sprint releases or cancels
  a single booking)
- **Added by:** SCRUM-155 AC3 — branch `venue-booking-conflicts`
- **Waiting on:** SCRUM-231 Release an affected booking (Sprint 3), and
  SCRUM-105 (cancel an event, which releases its bookings)
- **Where:** `src/domain/venue-booking/service.ts` — `conflictsFor()`
  (`DUMMY(SCRUM-105) D-15`; first `DUMMY(SCRUM-231) D-15`)
- **What is real and what is faked:** the approval check is real: a booking
  that is no longer confirmed no longer clashes, so the approval goes through.
  Only the release or cancellation is faked: testers delete the clashing
  `venue_booking` row by hand (`node scrum155-manual.mjs release <BR>`).
- **To replace:** once a booking can be released or cancelled through the app,
  re-run SCRUM-155 AC3 (TC-155-04 and TC-155-05) through that action, then
  remove the marker.
- **Status:** **Replaced.** Release half by SCRUM-231 (branch
  `venue-booking-release`): a booking is released through the app, so
  TC-155-04 no longer needs the helper. Cancellation half by SCRUM-105 (branch
  `cancel-event`): cancelling an event releases its bookings ("Event
  cancelled", who and when), so TC-155-05 is re-run by cancelling the event
  through the app instead of deleting its booking (TC-105-19). Marker
  removed.

### D-16 — getVenueCommitments returns a fixture booking

- **Kind:** Stand-in code
- **Added by:** SCRUM-239 — branch `scrum-239-availability-time-ranges`
- **Waiting on:** SCRUM-239 Check venue availability in 15-minute time ranges
  (its own real query, due Sprint 3 day 4, once the shared time-model migration
  is merged)
- **Where:** ~~`src/domain/availability/service.ts` — `getVenueCommitments()`
  (`DUMMY(SCRUM-239) D-16`)~~ — marker removed
- **What it does:** returns one confirmed booking, 10:00–12:00, at the venue
  asked about on every date in the range, filtered to the range like the real
  check will be. It reads nothing from the database. The signature, the
  `VenueCommitment` shape (`src/domain/availability/schema.ts`) and the
  half-open overlap rule (`rangesOverlap` in `src/domain/shared/times.ts`) are
  real and do not change when the stub is replaced. Lets SCRUM-227 (holds) and
  SCRUM-229 (replacement venue) build against a non-empty result from day 2.
- **To replace:** query `venue_booking` (confirmed) and the unavailable periods
  by their start and end times, add holds once SCRUM-227 has them, and keep
  the same return shape. Re-run `tests/unit/venue-commitments.test.ts`, then
  ask the SCRUM-227 and SCRUM-229 owners to re-run the ACs that use the check.
- **Status:** Replaced (SCRUM-239, PR #92). `getVenueCommitments()` now
  reads confirmed bookings (`venue_booking`) and unavailable periods
  (`venue_unavailable_slot`) by their start and end times, added by the
  time-model migration (`20261008140500_time_model.sql`, PR #89). Same
  signature and return shape. Holds join once SCRUM-227 adds them. Re-checked
  with `tests/unit/venue-commitments.test.ts` and
  `tests/integration/venue-commitments.test.ts`; SCRUM-227 and SCRUM-229
  owners to re-run the ACs that use it.

### D-17 — SCRUM-225's occupied-time rule is a local stand-in

- **Kind:** Stand-in code
- **Added by:** SCRUM-226 — branch `setup-turnaround-occupied`
- **Waiting on:** SCRUM-225 (its owner writes the setup + turnaround rule;
  SCRUM-226's notes call it "SCRUM-225's occupied time", agreed 10 Oct 2026)
- **Where:** `src/domain/availability/occupiedPeriodDummy.ts` —
  `occupiedPeriod()`, and its import in `src/domain/availability/service.ts`
  (`DUMMY(SCRUM-225) D-17` in both)
- **What is real and what is faked:** everything SCRUM-226 owns is real:
  `getVenueCommitments` reads each venue's `setup_minutes` and
  `turnaround_minutes` and widens both the confirmed bookings and the range
  asked about. Only the arithmetic of the rule is a stand-in: period in,
  period plus setup before and turnaround after out, kept within the day.
  Venue Staff cannot set the minutes until SCRUM-225's form exists, so testers
  set them directly: `update venues set setup_minutes = 30,
  turnaround_minutes = 45 where name = '<venue>';`
- **To replace:** import SCRUM-225's function in
  `src/domain/availability/service.ts` in place of the dummy's, delete
  `occupiedPeriodDummy.ts`, keep the same call. If its name or arguments
  differ, change the two call sites (`getVenueCommitments` and
  `widenedWindow`). Re-run `tests/unit/venue-commitments.test.ts` and
  `tests/integration/venue-commitments.test.ts` (the SCRUM-226 cases) and
  SCRUM-226's manual test cases, then remove the markers.
- **Status:** Replaced (SCRUM-226, branch `setup-turnaround-occupied`, once
  SCRUM-225 merged). `getVenueCommitments` now calls SCRUM-225's
  `committedMinutes` (`src/domain/venues/policy.ts`), kept within the day by
  `committedPeriod`; `occupiedPeriodDummy.ts` is deleted and the markers are
  removed. Venue Staff set the minutes through SCRUM-225's venue form. Re-checked
  with `tests/unit/venue-commitments.test.ts`,
  `tests/integration/venue-commitments.test.ts` and SCRUM-226's manual test
  cases.

### D-18 — An equipment line is reserved by hand

- **Kind:** Out-of-sprint stand-in (reserving equipment is SCRUM-167, a
  stretch story not built this sprint)
- **Added by:** SCRUM-160 AC8 — branch `event-equipment-request`
- **Waiting on:** SCRUM-167 (equipment reservation); since Sprint 4, SCRUM-173
- **Where:**
  `supabase/migrations/20261017175923_event_equipment_request.sql` — the
  `equipment_reservation` table (`DUMMY(SCRUM-167) D-18`);
  `src/lib/supabase/equipmentRequests.ts` — `fetchReservedLineIds()`
  (`DUMMY(SCRUM-167) D-18`);
  `tests/integration/equipment-request.test.ts` — `reserve()`
  (`DUMMY(SCRUM-167) D-18`)
- **What is real and what is faked:** the warning is real. A reduction (or
  removal) of a reserved line is refused with 409 and "This item has already
  been reserved. Confirm to apply the change to its reservation." until the
  coordinator confirms, and an unreserved line is changed at once (AC7). Only
  the reservation is faked: a line is reserved when a row in
  `equipment_reservation` names it, and testers insert that row by hand in
  Studio (`insert into equipment_reservation (line_id) values ('<line id>');`).
- **To replace:** once SCRUM-167 reserves equipment, point
  `fetchReservedLineIds()` at its reservation record (same signature: the
  reserved line ids out of the ones given), drop `equipment_reservation` in
  SCRUM-167's migration if it is not reused, and remove the markers. Re-run
  SCRUM-160 AC7 and AC8 (TC-160-19 to TC-160-23) with a line reserved through
  the app.
- **Updated by SCRUM-167 (Sprint 4), now waiting on SCRUM-173.** Since the
  Sprint 4 cards, checking availability is SCRUM-167 and reserving is
  SCRUM-173. `20261022004756_equipment_commitment_window.sql` keeps
  `equipment_reservation` and gives it what SCRUM-167's check reads: a
  quantity, the commitment window it holds and a Reserved/Released status. A
  row inserted with only its `line_id` still works (the
  `equipment_reservation_fill` trigger takes the line's quantity and the
  event's window), so the Studio insert above and `scripts/seed-scrum164.mjs`
  run unchanged; `scripts/seed-b1.mjs` inserts the B1 holds the same way. A
  confirmed reduction of a reserved line now lowers its reservation to match
  (`equipment_request_line_cap_reservation`). `fetchReservedLineIds()` keeps
  its signature and counts only reservations still Reserved. The markers in
  `equipmentRequests.ts` and the integration test now read
  `DUMMY(SCRUM-173) D-18`; the ones in the SCRUM-160 migration and
  `scripts/seed-scrum164.mjs` are left as they are (a merged migration is not
  edited, and the seed is SCRUM-164's).
- **To replace (SCRUM-173):** reserve through the app into the same table,
  mark this entry Replaced and remove the `DUMMY(SCRUM-173) D-18` markers.
  Re-run SCRUM-160 AC7 and AC8 (TC-160-19 to TC-160-23) with a line reserved
  through the app.
- **Status:** Replaced (SCRUM-173, Sprint 4). Technical Support Staff reserve
  through `reserve_equipment` (`20261022011508_reserve_equipment.sql`) from
  the Outstanding list on the event's equipment page. The
  `DUMMY(SCRUM-173) D-18` markers in `equipmentRequests.ts` and
  `tests/integration/equipment-request.test.ts` are removed; that test's
  `reserve()` still inserts a row (its events have no venue booking), and
  `tests/integration/equipment-reservation.test.ts` reserves a line through
  the app and checks SCRUM-160 AC8 against it. `scripts/seed-b1.mjs` reserves
  through `reserve_equipment`. `tests/integration/equipment-availability.test.ts`
  (SCRUM-167) still inserts its holds directly, as test data.

### D-19 — An equipment request's status and unavailable items are set by hand

- **Kind:** Out-of-sprint stand-in (setting an equipment request's status is
  SCRUM-166, not in this sprint)
- **Added by:** SCRUM-164 AC3, AC4 — branch `equipment-request-queue`
- **Waiting on:** SCRUM-166 (Update the status of an equipment request)
- **Where:**
  `supabase/migrations/20261018174009_equipment_request_status.sql` — the
  `equipment_request.status` and `equipment_request_line.unavailable` columns
  (`DUMMY(SCRUM-166) D-19`);
  `src/domain/equipment-request/schema.ts` — `EQUIPMENT_REQUEST_STATUSES`
  (`DUMMY(SCRUM-166) D-19`);
  `src/lib/supabase/equipmentRequests.ts` — `fetchEquipmentRequestsByStatus()`
  (`DUMMY(SCRUM-166) D-19`);
  `tests/integration/equipment-queue.test.ts` — `setStatus()` and
  `setUnavailable()` (`DUMMY(SCRUM-166) D-19`)
- **What is real and what is faked:** the queue is real. It reads the stored
  status and lines: under review and partially fulfilled are listed, fulfilled
  and unable to fulfil are not (AC3), and a partially fulfilled request shows
  how many of its lines are unavailable (AC4). The columns are real too,
  shaped the way SCRUM-166's ACs name them, and every request starts under
  review (SCRUM-166 AC1). Only the setting is faked: nothing in the app changes
  a status or marks a line unavailable, so testers do it by hand in Studio:
  `update equipment_request set status = 'partially_fulfilled' where event_request_id = '<event id>';`
  and `update equipment_request_line set unavailable = true where id = '<line id>';`
- **To replace:** ~~SCRUM-166 writes to these two columns from its status form
  (adding its own identity, timestamp and reason columns alongside), keeps the
  four status values, and removes the markers. Re-run SCRUM-164 AC3 and AC4
  (TC-164-07 to TC-164-12) and `tests/integration/equipment-queue.test.ts`
  with statuses set through the app.~~ Done.
- **Status:** Replaced (SCRUM-166, branch `equipment-request-status`).
  Technical Support Staff set the status and the unavailable lines on the
  event's equipment request page, through `updateEquipmentRequestStatus` and
  `set_equipment_request_status`
  (`20261023044500_equipment_request_status_update.sql`, which adds
  `status_set_by`, `status_set_at` and `unable_reason`). The four status values
  are kept. `tests/integration/equipment-queue.test.ts` now sets statuses
  through the app (`setStatus()`; `setUnavailable()` is gone), and
  `scripts/seed-scrum164.mjs` still writes them straight to the table as
  fixture data, without the marker. The marker comment in the applied
  migration `20261018174009_equipment_request_status.sql` is left as it is,
  since a migration on `main` is not edited.

### D-20 — Each role's nav holds only its landing page

- **Kind:** Stand-in code (each role's nav items belong to its own Role
  Navigation story)
- **Added by:** SCRUM-249 Shared header
- **Waiting on:** SCRUM-250 (Event Organiser), 251 (Event Coordinator), 252
  (Event Coordinator Lead), 253 (Venue Staff), 254 (Technical Support Staff),
  255 (Attendee), 256 (Safety Officer) — one marker per role
- **Where:** `src/domain/navigation/roleNav.ts` — `ROLE_NAV`, one
  `DUMMY(SCRUM-25x) D-20` line per role
- **What is real and what is faked:** the header is real: it renders the nav
  of the role being worked as, highlights the current item (SCRUM-249 AC4)
  and folds it into a menu button below 768 px (AC6). Only the items are
  faked: until each nav story lands, a role's nav is a single link to its
  landing page, so AC4 and AC6 have a real item to test against.
- **To replace:** each nav story replaces its own role's entry in `ROLE_NAV`
  with the items its AC2 lists, in that order, and removes its marker line.
  Keep the landing page first (the `ROLE_NAV` test in
  `tests/unit/shared-header.test.ts` checks it). Re-run TC-249-15 to TC-249-17
  (AC4) and TC-249-25 to TC-249-27 (AC6) for that role.
- **Status:** Partly replaced. **Technical Support Staff:** replaced by
  SCRUM-254 (branch `tech-support-nav`): Equipment requests, Equipment
  catalogue, Venues; marker removed. The SCRUM-164 tabs (`TechnicalSupportNav`)
  were removed in the same change, since the nav bar now does their job on
  every page (PO, 22 Oct 2026). **Attendee:** replaced by SCRUM-255 (branch
  `attendee-navigation`): AC2 lists only Open events, which was already the
  stand-in item, so the entry is unchanged and its marker removed; TC-249-15
  to 17 and 25 to 27 re-run for the Attendee as TC-255-04. **Event
  Organiser:** replaced by SCRUM-250 (branch `organiser-navigation`): Event
  requests, New event request; marker removed. Because `/events/new` sits under
  `/events`, the header now highlights only the most specific current item
  (`currentNavHref` beside `isNavItemCurrent` in
  `src/domain/navigation/policy.ts`, agreed with SCRUM-249's owner); roles
  whose items don't nest are unaffected. TC-249-15 to 17 and 25 to 27 re-run
  for the organiser as TC-250-02, 06 and 07. **Safety Officer:** replaced by
  SCRUM-256 (branch `safety-officer-navigation`): AC2 lists only Safety
  checks, which was already the stand-in item, so the entry is unchanged and
  its marker removed; TC-249-15 to 17 and 25 to 27 re-run for the Safety
  Officer as TC-256-07, 10 and 14. **Event Coordinator:** replaced by SCRUM-251 (branch
  `scrum-251-coordinator-nav`): Review queue, My events, Venues, Client
  organisations, Equipment; marker removed. **Other roles:** still active,
  waiting on SCRUM-252 and 253.

### D-21 — An equipment reservation is released by hand

- **Kind:** In-sprint stand-in (releasing a reservation is SCRUM-177, in
  Sprint 4 but owned by someone else)
- **Added by:** SCRUM-173 AC6 (TC-173-09) — branch `equipment-reservation`
- **Waiting on:** SCRUM-177 (release reserved equipment)
- **Where:**
  `scripts/seed-b1.mjs` — `releaseByHand()` (`DUMMY(SCRUM-177) D-21`);
  `tests/integration/equipment-reservation.test.ts` — TC-173-09
  (`DUMMY(SCRUM-177) D-21`)
- **What is real and what is faked:** the listing is real. SCRUM-173 AC6 lists
  each reservation with its status, Reserved or Released, read from
  `equipment_reservation.status`, and a Released one no longer holds its units
  (the line shows as outstanding again; SCRUM-167's check no longer counts it).
  Only the release is faked: nothing in the app releases a reservation yet, so
  the seed and the test set the status by hand:
  `update equipment_reservation set status = 'released' where id = '<reservation id>';`
- **To replace:** SCRUM-177 releases through the app into the same status
  column. Release through it in `scripts/seed-b1.mjs` and TC-173-09, remove
  the markers, and re-run TC-173-09.
- **Status:** Replaced (SCRUM-177, branch `equipment-release`). The seed
  releases EQ-173-09 through `release_equipment_reservation` and TC-173-09
  through `releaseEquipmentReservation`, with a reason; markers removed;
  TC-173-09 re-run (SCRUM-177's TC-177-10).

### D-22 — An event's registration period is set by the seed script

- **Kind:** In-sprint stand-in (setting the period is SCRUM-185 AC5, in
  Sprint 4 but owned by Dylan)
- **Added by:** SCRUM-181 AC2, AC3, AC4 (TC-181-05 to TC-181-13) — branch
  `event-register`
- **Waiting on:** SCRUM-185 AC5 (the coordinator sets the registration start
  and end dates)
- **Where:** `scripts/seed-event-registration-test-data.mjs` — the header
  comment (its D-22 marker, removed when SCRUM-185 replaced it), and the `registration_start_date` /
  `registration_end_date` it writes for each event. Also
  `scripts/seed-scrum180.mjs` (SCRUM-180, branch `browse-open-events`), the
  same way, for the events Open events lists or leaves out (TC-180-01 to 05)
- **What is real and what is faked:** the period is real. The columns
  `event_request.registration_start_date` and `registration_end_date` (dates,
  both inclusive, added by SCRUM-181's migration
  `20261024130843_event_registration.sql`) are what SCRUM-181 reads, in the
  service and again in `register_for_event`, to refuse registering before the
  start date (AC2) or after the end date (AC3). Only the setting is faked:
  nothing in the app writes the columns yet, so the seed script sets them,
  relative to today, for each test case. An event with no period takes no
  registrations and is not found on the Attendee's page.
- **To replace:** SCRUM-185 AC5's form saves to the same two columns (both
  together; the table refuses one without the other, or an end before the
  start). Set the periods through the form for TC-181-05 to TC-181-12 instead
  of the seed, remove the marker, and re-run those test cases. Then the same
  for SCRUM-180's TC-180-01 to TC-180-05, which read the same two columns
  (Open events lists an event while today is inside its period).
- **Limit which events can have a period (SCRUM-180 review, PR #154):** Open
  events leaves out only Cancelled and Completed events (the PO's reading of
  SCRUM-180 AC1, 28/10/2026), so it lists any other event whose period
  includes today: a Draft, Submitted, Rejected or Planning one too. That
  cannot happen while only the seed sets a period. When SCRUM-185 AC5's form
  replaces the seed, it must let a period be set only on an event that is
  going ahead (SCRUM-185 allows editing only while the event is Confirmed),
  or Open events needs a list of the statuses it may show instead.
- **Status:** Replaced by SCRUM-185 AC5 (branch `scrum-185-registration-list`,
  27 Oct 2026). The assigned coordinator of a Confirmed event sets the start
  date, end date and capacity on `/events/<id>/registrations`, which saves to
  the same columns. The seed scripts (`seed-event-registration-test-data.mjs`,
  `seed-scrum180.mjs`) still set periods as test data, without the marker. TC-181-05 to TC-181-13 and `tests/integration/register-for-event.test.ts`
  re-run and pass; `tests/integration/registration-list.test.ts` TC-185-08
  checks 181's attendee page reads the period the form saved. The limit above
  is met: the form saves a period only while the event is Confirmed
  (`acceptsRegistrationSettings`, and the update is filtered on
  `status = 'confirmed'`), so the app gives a period only to an event that is
  going ahead. SCRUM-180's automated TC-180-01 to TC-180-05 re-run after
  merging `main` (31 Oct) and pass.

### D-23 — Places always remain

- **Kind:** In-sprint stand-in (refusing a full event is SCRUM-182, in
  Sprint 4)
- **Added by:** SCRUM-181 AC1 ("places remain", TC-181-02) — branch
  `event-register`
- **Waiting on:** SCRUM-182 AC1 (a full event refuses registration) and AC2
  (two people taking the last place at the same moment)
- **Where:** ~~`supabase/migrations/20261024130843_event_registration.sql` —~~
  ~~`event_has_places_remaining` (`DUMMY(SCRUM-182) D-23`)~~ — marker removed;
  the comment there now points at SCRUM-182's migration
- **What is real and what is faked:** registering is real and goes through one
  database function, `register_for_event`, which locks the event row, checks
  the period and the duplicate, then asks `event_has_places_remaining` and
  returns `'full'` if it says no (the service turns that into a 409
  `CAPACITY_EXCEEDED`). Only the answer is faked: the function always returns
  true. `event_request.registration_capacity` exists (null until set; what it
  is set to is SCRUM-185 AC6's rule) but nothing counts against it yet.
- **To replace:** ~~SCRUM-182 replaces the body of `event_has_places_remaining`
  in a new migration with a count of the event's Registered rows against
  `registration_capacity`. `register_for_event` already calls it with the
  event row locked, so two registrations for the last place are counted one
  after the other. Remove the marker and re-run TC-181-02 (the last place can
  still be taken) and `tests/integration/register-for-event.test.ts`.~~ Done
  (SCRUM-182, branch `refuse-register`):
  `20261025184920_event_registration_capacity.sql` counts the Registered rows
  against `registration_capacity`; no capacity set counts as full (PO,
  25/10/2026). Because of that, every event in
  `scripts/seed-event-registration-test-data.mjs` and
  `register-for-event.test.ts` now has a capacity. TC-181-02 and
  `register-for-event.test.ts` re-run and passed on 25/10/2026.
- **Status:** Replaced (SCRUM-182, branch `refuse-register`).

### D-24 — An event's registration capacity is set by the seed script

- **Kind:** In-sprint stand-in (entering the capacity is SCRUM-185 AC5, in
  Sprint 4 but owned by Dylan; CL-59)
- **Added by:** SCRUM-182 AC1, AC2, AC3 (TC-182-01 to TC-182-12) — branch
  `refuse-register`
- **Waiting on:** SCRUM-185 AC5 (the coordinator enters the capacity with the
  registration dates). AC6 only refuses a capacity above the largest of the
  event's venue capacities; it does not fill it in (PO, 25/10/2026).
- **Where:** `scripts/seed-scrum182.mjs` — the header comment
  (its D-24 marker, removed when SCRUM-185 replaced it) and the `registration_capacity` it writes per
  event; `scripts/seed-event-registration-test-data.mjs` — the
  `registration_capacity: 20` it now writes for SCRUM-181's events
  (marker likewise removed)
- **What is real and what is faked:** the count is real.
  `event_has_places_remaining` and `isEventFull` compare the event's
  Registered rows with `event_request.registration_capacity` (integer, null
  until set, at least 1). Only the setting is faked: nothing in the app writes
  the column yet, so the seed sets it. An event with no capacity is refused as
  full, so until SCRUM-185 AC5 is on main, only seeded events take
  registrations. Replacing a venue does not change the stored capacity; only
  the coordinator's save does (PO, 25/10/2026).
- **To replace:** SCRUM-185 AC5's form saves `registration_capacity` with the
  two registration dates. Set the capacities through the form for
  TC-182-01 to TC-182-12 instead of the seed (TC-182-10 still needs the
  capacity lowered after three have registered), remove both markers, and
  re-run those cases.
- **Status:** Replaced by SCRUM-185 AC5 (branch `scrum-185-registration-list`,
  28 Oct 2026). The assigned coordinator of a Confirmed event enters the
  capacity with the two dates on `/events/<id>/registrations`; AC6 refuses one
  above the largest of the event's venue capacities. A capacity can be lowered
  later through the same form (TC-182-10's step). Both seed scripts still set
  capacities as test data, without the marker. `tests/integration/refuse-full-registration.test.ts`
  (TC-182-01 to 12) re-run and pass.

### D-25 — A registration is withdrawn by hand

- **Kind:** In-sprint stand-in (withdrawing is SCRUM-184, in Sprint 4)
- **Added by:** SCRUM-182 AC3 (TC-182-09 to TC-182-12) — branch
  `refuse-register`
- **Waiting on:** SCRUM-184 (the attendee withdraws their registration)
- **Where:** `scripts/seed-scrum182.mjs` — the `--withdraw`,
  `--withdraw-over`, `--withdraw-attendee` and `--withdraw-waiting` flags
  (`DUMMY(SCRUM-184) D-25`); `tests/integration/refuse-full-registration.test.ts`
  — `withdraw()` (`DUMMY(SCRUM-184) D-25`)
- **What is real and what is faked:** what SCRUM-182 tests is real: only
  Registered rows count against the capacity, so a withdrawn registration
  gives its place back as soon as its status changes, with no waiting list.
  Only the withdrawing is faked: the flags and the test helper set
  `event_registration.status` to `withdrawn`, the value SCRUM-184 will write
  (SCRUM-181's migration already allows it).
- **To replace:** once SCRUM-184 is on main, withdraw through its page or
  function in TC-182-09 to TC-182-12 instead of the flags, have `withdraw()`
  in the integration test call SCRUM-184's function, remove the marker and
  re-run those cases.
- **Status:** Active.

### D-26 — A change request's decision is set by hand

- **Kind:** Stand-in code (a shared table created early, with nothing yet
  writing its decision columns)
- **Added by:** SCRUM-187 — branch `change-request-raise`
- **Waiting on:** SCRUM-190 (Approve a change request and apply it), SCRUM-191
  (Reject a change request with a reason)
- **Where:**
  - `supabase/migrations/20261028090000_change_request.sql` — `change_request`'s
    `decided_by`, `decided_at`, `decision_reason` columns
  - `src/domain/change-request/service.ts` — `raiseChangeRequest()` never
    writes them; `listChangeRequests()` reads them back as-is
    (`DUMMY(SCRUM-190) D-26`, `DUMMY(SCRUM-191) D-26`)
  - `tests/integration/change-request.test.ts` — `seedDecision()`
    (`DUMMY(SCRUM-190) D-26`, `DUMMY(SCRUM-191) D-26`)
- **What is real and what is faked:** raising a request (AC1) and listing it
  (AC6) are both real, against a real database. Only the decision itself is
  faked: nothing in the app approves or rejects a change request yet, so the
  integration test's `seedDecision()` sets `status`/`decided_at`/
  `decision_reason` directly in Postgres to prove AC6 reads a decided request
  correctly once one exists. AC7 ("the event shows the new values") is out of
  scope for this story entirely — it is SCRUM-190's own write, not read back
  here.
- **To replace:** SCRUM-190/191 write these three columns from their own
  approve/reject actions (already shaped the way their ACs describe them: one
  decision, one reason, one timestamp). Re-run TC-187-11 against a request
  decided through the app, and TC-187-12 against an event whose approved
  change was actually applied by SCRUM-190, then remove the markers. Stamp
  `decided_at` the
  same "one clock" way `event_request.decided_at`/`submitted_at`/`assigned_at`
  already are (a DB trigger reading `now()`, not a caller-supplied value -
  see `set_decided_at`/`set_assigned_at`/`set_submitted_at` in the
  event_request migrations), so a decision can never be backdated before its
  own request. `change_request` has no such trigger yet since nothing writes
  `decided_at` yet; add one alongside SCRUM-190/191's migration.
- **Status:** Active.

*Originally numbered D-22; renumbered to D-26 during the 2026-10-28 rebase
onto `main`, since SCRUM-181/182/184 had taken D-22 through D-25 on `main` in
the meantime.*
