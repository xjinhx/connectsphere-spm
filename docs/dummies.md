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
- **Waiting on:** SCRUM-24 Notification System
- **Where:** `src/domain/assignment/service.ts` — `assignCoordinator()`
- **To replace:** notify the assigned coordinator from `assignCoordinator()`,
  straight after the assignment is recorded, using SCRUM-24's mechanism;
  re-run US-8.1-TC02 (SCRUM-94 AC1).
- **Status:** Active

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
  gives a booking its own date or slot, `update_venue` and
  `fetchConfirmedFutureBookings()` must read that instead. (Raised in review
  of PR #61.)
- **To replace:** SCRUM-148's approval flow writes `venue_booking` rows (and
  may widen `status` beyond `'confirmed'`). Nothing in SCRUM-120 changes;
  re-run `tests/integration/venue-capacity-cut.test.ts` and SCRUM-120 AC2 and
  AC3 by hand against a booking made through that flow, then remove the
  markers.
- **Status:** Replaced (SCRUM-148, branch `venue-booking-approval`).
  `decide_venue_booking_request` writes one booking per venue, date and slot,
  with its own `date` and `slot`, and `venue_booking_one_per_slot` refuses a
  second confirmed booking of a slot
  (`20261006100000_venue_booking_decision.sql`). The hand-made stand-in rows
  are removed by that migration. `update_venue` and
  `fetchConfirmedFutureBookings()` now judge "future" on the booking's own
  date and count an event once. `venue-capacity-cut.test.ts` passes, its setup
  rows now carrying a date and slot. The TypeScript markers are removed; the
  comments in the 20260924170000 migration stay as history rather than editing
  an applied migration. Still to switch to a booking's own date once on main
  together: SCRUM-151's `affected_booking_slot` view and SCRUM-128's search.

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

### D-10 — Planning is added and reached without SCRUM-101

- **Kind:** Stand-in code
- **Added by:** SCRUM-103 — PR #69
- **Waiting on:** SCRUM-101 Move an event through its statuses as work is done
- **Where:**
  - `supabase/migrations/20260928120000_event_request_lifecycle_statuses.sql`
    — adds `'planning'` with `IF NOT EXISTS`. SCRUM-101's own migration
    (`20260927090000_event_request_planning_status.sql`, branch
    `move-event-status`) adds the same value and runs first on a fresh reset.
  - `src/domain/event-request/schema.ts` — `'planning'` in
    `EventRequestStatusEnum` and its label.
  - `tests/integration/event-status-transitions.test.ts` —
    `createConfirmedRequest()` moves approved -> planning with
    `changeEventStatus`, where the app will use SCRUM-101's action.
  - Manual testing: TC-103-09 (and the SCRUM-97/99 cases that need a Planning
    or Confirmed event) set Planning with the SCRUM-103 harness,
    `tests/manual/change-event-status.test.ts`.
- **To replace:** once SCRUM-101 is on main: keep a single `'planning'` in
  `EventRequestStatusEnum`, `EVENT_REQUEST_STATUS_LABELS` and the badge
  (merge whichever copy arrives second); leave the `IF NOT EXISTS` line in the
  migration (it is then a no-op, and removing it would change an applied
  migration); switch `createConfirmedRequest()` to SCRUM-101's approved ->
  planning function and set Planning through its action in the manual tests.
  Re-run TC-103-01 to 09 (SCRUM-103 AC1-AC4).
- **Status:** Active

### D-13 — A booking decision's "notification" is only the recorded decision

- **Kind:** Stand-in code (SCRUM-193's in-app notifications are in this sprint
  but not on main yet)
- **Added by:** SCRUM-148 AC2 — branch `venue-booking-approval`
- **Waiting on:** SCRUM-193 View my notifications in the application
- **Where:** `src/domain/venue-booking/service.ts` —
  `decideVenueBookingRequest()` (`DUMMY(SCRUM-193) D-13`)
- **What it does:** AC2's "the assigned Event Coordinator is notified" is the
  decision recorded on each line (status, `decided_by`, `decided_at`, reason),
  returned with the event's `coordinatorId`. The same minimum honest
  notification as D-03 (SCRUM-94).
- **To replace:** once SCRUM-193's notifications exist, create one for the
  event's coordinator from `decideVenueBookingRequest()` after the decision is
  saved (it would need a booking-decision type; 193's list has none yet).
  Re-run SCRUM-148 AC2.
- **Status:** Active
