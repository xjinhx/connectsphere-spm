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

### D-04 — The bookings a capacity cut would affect are always an empty list

- **Kind:** Stand-in code
- **Added by:** SCRUM-120 — commit `80dd30e` (PR #13)
- **Waiting on:** SCRUM-148 Approve a booking request
- **Where:**
  - `src/domain/venues/service.ts` — `findAffectedFutureBookings()` returns
    `[]` (`DUMMY(SCRUM-148) D-04`)
  - `src/app/api/venues/[id]/route.ts` — the venue update handler
    (`DUMMY(SCRUM-148) D-04`)
- **To replace:** `findAffectedFutureBookings()` takes the venue id and the
  proposed maximum capacity and returns the confirmed future bookings above
  it; `updateVenue` refuses unless `confirmAffectedBookings` is true; re-test
  SCRUM-120 AC2 and AC3.
- **Status:** Active. Its ACs can't be tested against this stand-in — there is
  nothing to find — so they stay in Merged - Pending Verification.

### D-05 — A capacity cut doesn't notify the affected coordinators

- **Kind:** Out-of-sprint stand-in
- **Added by:** SCRUM-120 — commit `80dd30e` (PR #13)
- **Waiting on:** SCRUM-24 Notification System — and D-04 first, since there
  are no affected events to notify about until then
- **Where:** `src/domain/venues/service.ts` — `DUMMY(SCRUM-24) D-05` on
  `findAffectedFutureBookings()`
- **To replace:** after a confirmed capacity cut, notify the coordinator
  assigned to each affected event (`event_request.coordinator_id`, from
  SCRUM-94); re-test SCRUM-120 AC4.
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
