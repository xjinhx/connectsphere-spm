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
  (SCRUM-94) and D-06 (SCRUM-96).
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
- **Status:** Active

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
- **Status:** Active

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
  (`DUMMY(SCRUM-231) D-15`)
- **What is real and what is faked:** the approval check is real: a booking
  that is no longer confirmed no longer clashes, so the approval goes through.
  Only the release or cancellation is faked: testers delete the clashing
  `venue_booking` row by hand (`node scrum155-manual.mjs release <BR>`).
- **To replace:** once a booking can be released or cancelled through the app,
  re-run SCRUM-155 AC3 (TC-155-04 and TC-155-05) through that action, then
  remove the marker.
- **Status:** Active

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
- **Status:** Active
