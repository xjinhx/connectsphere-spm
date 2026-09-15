# SCRUM-89 / SCRUM-90 — Build Summary

**Branch:** `review-detail-clarification` (off `main` @ `b1e21d2`; merged up to
`main`'s `6780cdf` — SCRUM-94, SCRUM-88 and others — on 2026-09-15; not
merged into `main`)
**Epic:** Event Review and Approval (US-7.1 / US-7.2)
**Status:** Code-complete on this branch, including SCRUM-89 AC3 (see
"Known gap" below — now closed). **Not Done per team DoD** — see
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
| AC3 — a request assigned to another Coordinator is denied | `canReviewDetail()` in `domain/review/policy.ts`, applied in `getReviewDetail()` — see "Known gap" below, now closed |

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

## Known gap: SCRUM-89 AC1 / AC3 — "assigned coordinator" (closed 2026-09-15)

Originally: there was no `coordinator_id` column — Coordinator Assignment
(SCRUM-94/95/96) hadn't landed — so both new endpoints were gated by **role
only** (any Coordinator, via `assertPermission('event_request_review' /
'event_request_clarification')`), not by assignment.

**SCRUM-94 has since merged into `main`** (PR #28, `coordinator_id` /
`assigned_by` / `assigned_at` on `event_request`). This branch has been
merged up to that point, and `getReviewDetail()` now checks
`canReviewDetail(coordinatorId, actorUserId)` in `domain/review/policy.ts`
before returning a request: an unassigned request stays open to any
Coordinator (the card says nothing about that case, and assignment is a
one-way Event Operations Manager action per SCRUM-94 AC4, never
self-service), an assigned one is denied to anyone but the assigned
Coordinator. Unit-tested in `tests/unit/review-policy.test.ts`
(`canReviewDetail`).

**Note this only closes SCRUM-89 AC3.** SCRUM-92's approve route
(`src/app/api/event-requests/[id]/approve/route.ts`) has the identical gap in
its own comment, still unresolved on `main` — that's SCRUM-92's own already-
merged story, not this ticket's to touch; flagging it here rather than fixing
it silently, per CLAUDE.md's rule against scaffolding someone else's story.

**Still not covered:** the row actually carrying `coordinator_id` end-to-end
through `getReviewDetail`, and the 403 it produces, need a real database — no
Docker/Supabase CLI available in this environment (same limitation as
everything else in "What is not verified" below). Flag US-7.1-TC03 for
manual/integration verification, not as passing from this alone.

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
- `app/api/event-requests/[id]/review/route.ts` — passes `actor.userId`
  through to `getReviewDetail` for the AC3 check (2026-09-15)

---

## Verification performed on this branch

| Check | Result | When |
|---|---|---|
| `tsc --noEmit` | Clean | Original build; re-run clean after the `main` merge + AC3 |
| `eslint .` | Clean | Original build; re-run clean after the `main` merge + AC3 |
| `next build` | Clean, exit 0 — both new routes appear correctly in the route manifest | Original build only — not re-run after the merge (this environment has no `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` configured, so `next build` now fails collecting page data on unrelated routes before it would reach these; `tsc`/`eslint`/`vitest` are the verification that's actually current) |
| `vitest run tests/unit` | **272/272 passing** (185 prior + 3 new `canReviewDetail` cases + tests gained from the `main` merge) | Re-run after the `main` merge + AC3 |
| Diff against original `main` (`b1e21d2`) reviewed line-by-line | Confirmed no logic removed — every deleted line was a line replaced by a strict superset | Original build only |

**Merge with `main` (2026-09-15):** three conflicts — `domain/review/policy.ts`,
`lib/supabase/eventRequests.ts`, `tests/unit/review-policy.test.ts` — all
purely additive (this branch's SCRUM-90 additions alongside `main`'s SCRUM-88/
SCRUM-94 additions to the same files/functions), resolved by keeping both
sides. No logic from either side was dropped; `tsc`/`eslint`/`vitest`
above are the re-run confirming it.

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
   database-dependent parts — now including SCRUM-89 AC3 (an assigned
   request returning 403 to a different coordinator via the real route).
2. Manually walk US-7.1-TC01/TC02/TC03 and US-7.2-TC01/TC02/TC03 against a
   running app (TC03 was previously unexecutable; it is buildable now).
3. Regenerate `database.types.ts`.
4. Confirm with the team whether "unassigned request stays open to any
   Coordinator" (this branch's reading of AC3, see "Known gap" above) is
   actually what the Jira card intends, before treating AC3 as passing.
5. Open a PR referencing SCRUM-89 and SCRUM-90 explicitly, listing the ACs
   above and noting it was rebased onto `main` post-SCRUM-94 to close AC3.
