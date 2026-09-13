# SCRUM-89 / SCRUM-90 — Build Summary

**Branch:** `review-detail-clarification` (off `main` @ `b1e21d2`, not merged)
**Epic:** Event Review and Approval (US-7.1 / US-7.2)
**Status:** Code-complete on this branch. **Not Done per team DoD** — see
"What is not verified" below. Do not merge without a manual AC pass first.

---

## What was built

### SCRUM-89 — Review the full detail of a request
> *As an Event Coordinator, I want to open a submitted request and see
> everything the Event Organiser provided, so that I can judge whether
> planning can proceed.*

| Jira AC | Implementation |
|---|---|
| AC1 — assigned coordinator opens a submitted request, every field shown | `getReviewDetail()` in `domain/review/service.ts`, reusing `toEventRequest()` (now exported from `domain/event-request/service.ts`) so this can never show a field the Organiser's own view doesn't also show |
| AC2 — a blank section shown as "not provided", not omitted | `toEventRequest()` already maps every column as `null` rather than dropping the key; no filtering happens on the way out |
| AC3 — a request assigned to another Coordinator is denied | **Not implemented as written** — see "Known gap" below |

### SCRUM-90 — Request clarification from the Event Organiser
> *As an Event Coordinator, I want to return a request to the Event
> Organiser with a note describing what is unclear, so that I get the
> information I need without leaving the system.*

| Jira AC | Implementation |
|---|---|
| AC1 — clarification request moves status to Clarification Requested, note retained | `requestClarification()` in `domain/review/service.ts`; new `clarification_requested` status value + `clarification_note`/`clarification_requested_by`/`clarification_requested_at` columns |
| AC2 — Organiser reopens it, note shown, request editable again | `isEditable()`/`isResumable()` in `domain/event-request/policy.ts` widened to include `clarification_requested` (existing draft-edit machinery reused, not duplicated) |
| AC3 — missing/blank note is blocked, told a note is required | `RequestClarificationInputSchema` in `domain/review/schema.ts` — trims whitespace before the length check, so a whitespace-only note is refused the same as an empty one |

---

## Known gap: SCRUM-89 AC1 / AC3 — "assigned coordinator"

There is no `coordinator_id` column yet — Coordinator Assignment
(SCRUM-94/95/96) hasn't landed. Both new endpoints are gated by **role only**
(any Coordinator, via `assertPermission('event_request_review' /
'event_request_clarification')`), not by assignment.

This is not a workaround invented for this branch — it's the exact pattern
SCRUM-92 already established for its own analogous AC3 ("I am not the
Coordinator in charge... refused"), documented in the approve route's own
comment. Deliberately **not** building a `coordinator_id` column here myself:
that collided badly with a teammate's branch once already this sprint (the
`status`/`coordinatorId` reservation conflict on SCRUM-83/84), and it isn't
this ticket's to build.

**Consequence:** SCRUM-89 AC3 ("assigned to another Event Coordinator...
access is denied") cannot be honestly verified until SCRUM-94 lands. Flag
US-7.1-TC03 for re-execution then — do not mark it passing now.

---

## Files touched

**New:**
- `supabase/migrations/20260914090000_event_request_clarification_requested_status.sql`
- `supabase/migrations/20260914090100_event_request_clarification_note.sql`
- `src/app/api/event-requests/[id]/review/route.ts` (GET, SCRUM-89)
- `src/app/api/event-requests/[id]/clarification/route.ts` (POST, SCRUM-90)
- `tests/unit/review-detail-clarification-permission.test.ts`

**Extended (not duplicated):**
- `domain/review/{schema,policy,service}.ts` — same files SCRUM-92 already
  owns; added to rather than forked
- `domain/event-request/schema.ts` — status enum +`clarification_requested`,
  label map updated
- `domain/event-request/policy.ts` — `isEditable` widened
- `domain/event-request/service.ts` — `toEventRequest` exported (no logic
  change)
- `domain/identity/permissions.ts` — two new actions (`event_request_review`,
  `event_request_clarification`), granted to `coordinator`
- `lib/supabase/eventRequests.ts` — new columns on `EventRequestRow`/
  `COLUMNS`, new `markEventRequestClarificationRequested()`
- `components/event-request/EventRequestStatusBadge.tsx` — new status color
  (placeholder amber; flagged in-code for the component's owner to revise)
- `tests/unit/event-request-draft.test.ts`, `review-policy.test.ts`,
  `review-schema.test.ts` — extended with the new cases

---

## Verification performed on this branch

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `eslint .` | Clean |
| `next build` | Clean, exit 0 — both new routes appear correctly in the route manifest |
| `vitest run tests/unit` | **185/185 passing** (161 pre-existing + 24 new) |
| Diff against `main` reviewed line-by-line | Confirmed no logic removed — every deleted line is a line replaced by a strict superset (see below) |

**No regression check, concretely:** every one of the 9 `-` lines in the
diff against `main` is immediately replaced by a widened version of the same
line (e.g. `status === 'draft'` → `status === 'draft' || status ===
'clarification_requested'`; the 3-value status enum → 4-value; the
coordinator's two existing permissions preserved with two more appended).
Nothing merged by teammates was dropped.

---

## What is **not** verified

Per the team's Definition of Done, none of the above makes this "Done":

- **No integration test.** Both new database functions
  (`markEventRequestClarificationRequested`, the `set_clarification_requested_at`
  trigger) need a real Postgres to prove — no Docker/Supabase CLI available
  in this environment. `review-approval-view.test.ts`'s precedent (flagging
  DB-dependent assertions for the integration suite) was followed the same
  way here.
- **Migrations have not been applied to any real database.** Written to
  match the exact style of the three SCRUM-92 migrations they follow (enum
  value in its own transaction, then columns + constraints + trigger in a
  second file), but unexecuted.
- **`database.types.ts` was not regenerated.** The admin Supabase client is
  loosely typed (`SupabaseClient<any, 'public', any>`), so this doesn't
  break the build — but it's stale until someone with Docker runs
  `pnpm run db:types`.
- **No manual testing against the Jira ACs.** This is the team's actual DoD
  gate, and it hasn't happened.
- **No PR opened**, no review by anyone else.

## Suggested next step

1. Get this branch's migrations applied to a local Supabase instance
   (`pnpm run db:reset`) and add the integration tests
   `review-approval-view.test.ts` already implies are needed for the
   database-dependent parts.
2. Manually walk US-7.1-TC01/TC02 and US-7.2-TC01/TC02/TC03 against a running
   app.
3. Regenerate `database.types.ts`.
4. Open a PR referencing SCRUM-89 and SCRUM-90 explicitly, listing the ACs
   above and flagging the SCRUM-94 dependency for the reviewer.
