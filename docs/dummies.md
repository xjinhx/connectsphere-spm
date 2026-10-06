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
- **Status:** Active

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
  - Read by SCRUM-128 too: `src/lib/supabase/venues.ts` —
    `fetchConfirmedBookingsOn()`, and `src/domain/venues/service.ts` —
    `searchVenues()` (`DUMMY(SCRUM-148) D-04`)
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
  `fetchConfirmedFutureBookings()` and `fetchConfirmedBookingsOn()` must read
  that instead. (Raised in review of PR #61.)
- **To replace:** SCRUM-148's approval flow writes `venue_booking` rows (and
  may widen `status` beyond `'confirmed'`). Nothing in SCRUM-120 changes;
  re-run `tests/integration/venue-capacity-cut.test.ts` and SCRUM-120 AC2 and
  AC3 by hand against a booking made through that flow, and
  `tests/integration/venue-search.test.ts` for SCRUM-128 AC2 and AC3, then
  remove the markers.
- **Status:** Active

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
  recorded as unavailable excludes the venue (SCRUM-128 AC4), are real. Only
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
  slot withdrawn through that flow, then remove the markers.

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
- **Status:** Partly replaced (SCRUM-101). Done: a single `'planning'` in the
  enum, labels and badge; `createConfirmedRequest()` and `createAssignedEvent()`
  now use `enterPlanning`; the markers are removed. SCRUM-101's migration was
  renamed to `20260927090100_event_request_planning_status.sql` (it shared a
  version with `20260927090000_venue_setup_turnaround_slots.sql`, which fails
  `supabase start`). Still to do: the manual test cases that need a Planning
  event (TC-103-09 and the SCRUM-97/99 cases) should now reach Planning by
  raising a venue booking request instead of the SCRUM-103 harness, and
  TC-103-01 to 09 and TC-97-02 / TC-97-04 re-run.

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
