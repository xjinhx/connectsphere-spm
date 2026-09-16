# SCRUM-89 / SCRUM-90 — Build Summary

**Branch:** `review-detail-clarification` — rebased onto `main` @ `0fd7e19` on
2026-09-16 (linear, no merge commit; picks up SCRUM-94, SCRUM-88 and the
dummy-register work). Not merged into `main`.
**Consolidated stories:** US-7.1 (Jira 88+89) and US-7.2 (Jira 90+91)
**Status:** Both stories' own halves are code-complete **with UI**, and the
AC/test-case mapping below has been re-checked against
`ConnectSphere_Test_Cases_v3.xlsx`. **Not Done per team DoD** — no manual AC
pass, no PR, not merged. See "DoD status" at the bottom.

---

## Resolved: SCRUM-89 AC3 is real, and the check is restored

This branch changed its mind twice on whether viewing a request should be
denied to a Coordinator it is not assigned to. Settled on 2026-09-16 by
reading the Jira card itself, which is authoritative per CLAUDE.md.

**SCRUM-89's Jira ACs, verbatim:**

1. "Given I am the assigned coordinator and I open a submitted request, when
   the page loads, then every field the Event Organiser supplied is displayed
   with the value that was submitted."
2. "Given a section of the request was left blank by the organiser, when I
   view the request, then that section is shown as not provided rather than
   omitted."
3. "Given a submitted request is assigned to another Event Coordinator, when
   I request it directly by its identifier, then access is denied and no
   request data is returned."

(Customer clarification refs: #91.)

So AC3 **does** exist on this story. The intermediate commit that removed
`canReviewDetail()` argued from `ConnectSphere_Test_Cases_v3.xlsx`'s
consolidated US-7.1, which carries no such AC — but that sheet is explicitly
**not** authoritative, and this is exactly the drift CLAUDE.md warns about.
The check and its 403 are restored, now quoting the card's own wording.

`coordinator_id is null` (not yet assigned) stays open to any Coordinator:
AC3 denies only when a request *is* assigned to someone else, and inventing a
rule for the unassigned case would be building beyond the card.

---

## AC and test-case status

### US-7.1 — Review submitted requests from the queue (SCRUM-88 + **89**)

| AC / TC | Status | Where |
|---|---|---|
| AC1 / TC01 — queue lists assigned requests awaiting review, showing name, **client org**, proposed date, **submission date** | ⚠️ Partial — **SCRUM-88's page, not this branch's.** It lists name, reference, proposed date, status; client organisation and submission date are **not shown**, and `AssignedEvent` (SCRUM-94) doesn't carry them | `src/app/assigned-events/page.tsx` — flagged, deliberately not changed (another story's merged code) |
| AC2 / TC02 — open a queued request, see every submitted field | ✅ Built this branch | `src/app/events/[id]/review/page.tsx` (new), linked from the queue's new "Open" column; data from `getReviewDetail()` |
| AC2 / TC02 — …**including attachments** | ❌ Not possible — no attachment feature exists anywhere in the codebase, and none is in CLAUDE.md's Sprint 1 scope | Page shows an explicit "Attachments: not supported this sprint" row rather than omitting the clause silently |
| AC3 / TC03 — a reviewed request no longer appears as awaiting review | ✅ Already satisfied by `isAwaitingReview()` (`status === 'submitted'`), which every review action moves the request out of | `src/domain/review/policy.ts` (SCRUM-88's function, unchanged) |
| **SCRUM-89's own Jira AC3** — a request assigned to another Coordinator is denied, no data returned | ✅ Restored 2026-09-16 (see "Resolved" above). Unit-tested; integration test written but **not executed** (no Docker this session) | `canReviewDetail()` in `src/domain/review/policy.ts`, thrown from `getReviewDetail()` before the row is mapped |

### US-7.2 — Clarification exchange with the Organiser (SCRUM-**90** + 91)

| AC / TC | Status | Where |
|---|---|---|
| AC1 / TC01 — raise a clarification; saved with the event | ✅ Built (backend was already here; **UI added this branch**) | `RequestClarificationForm` on the review page → `POST /api/event-requests/[id]/clarification` |
| AC1 / TC01 — …**visible to the Organiser** | ✅ Fixed this branch — previously the note was stored but shown to nobody | `getClarificationView()` + `GET` on the same route; rendered on the Organiser's own `src/app/events/[id]/page.tsx` |
| AC2 / TC02 — Organiser responds, reply saved against the event | ❌ **Not built — this is SCRUM-91**, a separate ticket with no branch and no apparent assignee. Deliberately out of scope for this branch (team decision, 2026-09-15) | — |
| AC3 / TC03 — clarification **and any response** shown to anyone with access | ⚠️ Partial — the clarification half is shown to both the Organiser and any Coordinator; the response half is blocked on SCRUM-91 | Organiser page + review page |
| SCRUM-90's own AC3 — blank/missing note refused | ✅ Schema-level, trimmed before the length check; unit tested | `RequestClarificationInputSchema` |

### Bug found and fixed: the clarification round trip was a dead end

SCRUM-90 widened `isEditable()` to include `clarification_requested` (AC2's
"editable again") but left `canBeSubmitted()` at `'draft'` only, and
`markEventRequestSubmitted` filtering `.eq('status','draft')`. The Organiser's
page therefore **offered** Submit on a returned request and both the policy and
the database then **refused** it — so a clarified request could be edited but
never sent back, which is the whole point of US-7.2 ("without leaving the
system"). Confirmed against a real database before fixing.

Fixed by widening both halves to match `isEditable`: `canBeSubmitted()` and the
`.in('status', ['draft','clarification_requested'])` filter. `set_submitted_at`
only stamps on `draft -> submitted`, so a resubmission keeps its original
submission time and holds its place in the queue rather than going to the back
— no migration change needed. Covered by a unit test (the two rules must agree)
and four integration tests.

---

## Files touched

**New this session:**
- `src/app/events/[id]/review/page.tsx` — the Coordinator's full-detail review
  page (US-7.1 AC2), the "open it" seam SCRUM-88's page left for this story
- `src/components/event-request/RequestClarificationForm.tsx` — the
  "enter a message / Send" action (US-7.2-TC01)

**Changed this session:**
- `src/domain/review/service.ts` — `getReviewDetail(id, actorUserId)` enforces
  SCRUM-89 AC3, throwing `ForbiddenError` before the row is mapped so no
  request data leaves the function on refusal; new `getClarificationView()`
  for the Organiser-visible read
- `src/domain/review/policy.ts` — `canReviewDetail()` restored, quoting the
  Jira card (see "Resolved" above)
- `src/app/api/event-requests/[id]/clarification/route.ts` — added `GET`
- `src/app/api/event-requests/[id]/review/route.ts` — passes `actor.userId`
- `src/app/events/[id]/review/page.tsx` — renders a refusal message on
  `ForbiddenError` rather than crashing, and shows no request fields
- `tests/unit/review-policy.test.ts` — 3 `canReviewDetail` cases
- `tests/integration/review-detail-clarification.test.ts` — AC3 denial and
  assigned-coordinator cases, using a second real coordinator; assignment goes
  through an update so `set_assigned_at` stamps and
  `event_request_assignment_complete` holds
- `src/app/events/[id]/page.tsx` — Organiser now sees the clarification note
- `src/app/assigned-events/page.tsx` — "Open" link per row (the handoff its
  own comment described; no other change to SCRUM-88's page)
- `tests/unit/review-policy.test.ts` — `canReviewDetail` cases removed

**From the original build (unchanged this session):** the two migrations, the
review/clarification routes, `domain/event-request` status-enum and
`isEditable` widening, `domain/identity/permissions.ts`, `lib/supabase/eventRequests.ts`,
`EventRequestStatusBadge.tsx`, and the unit tests listed in git history.

---

## Verification performed

All of the following was run against the **local Supabase stack**
(`pnpm run db:start`), which this time was actually available.

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `eslint .` | Clean |
| `vitest run tests/` | **312/312 passing** — 271 unit, 41 integration |
| Migrations applied to a real database | ✅ All 15 apply cleanly from scratch, including this branch's two |
| `next build` | ✅ Clean, exit 0 — `/events/[id]/review` present in the route manifest |
| `database.types.ts` regenerated | ✅ Now carries the clarification columns and the 4-value status enum |
| Walked through the running app | ✅ See below |

**Driven through the running app** (`next dev`, two seeded accounts — a
Coordinator and an Organiser — with a real assigned request, exercising the
actual pages, middleware, session auth and API routes):

1. Coordinator's queue lists the assigned event with a working "Open" link
2. Review page shows purpose, description, proposed date, room layout,
   accessibility, equipment, technical support and registration (US-7.1-TC02)
3. Organiser is refused the review page
4. A whitespace-only note is refused, 400, "A note describing what is needed is required"
5. A real clarification saves, status → Clarification Requested, timestamp stamped by the trigger (US-7.2-TC01)
6. Organiser sees the note on their own event page, and the request is editable again (US-7.2 AC1, SCRUM-90 AC2)
7. It leaves the awaiting-review queue (US-7.1-TC03)
8. The clarification is visible to a Coordinator opening it (US-7.2-TC03, clarification half)
9. **Organiser resubmits successfully** — the dead end described above, now fixed
10. It returns to the coordinator's awaiting-review queue, with the clarification kept on the record

Not a substitute for the team's own manual DoD pass — it was driven over HTTP
rather than clicked in a browser (no Playwright in this project), so the
rendering itself has not been eyeballed.

---

## DoD status (CLAUDE.md's table)

| Criterion | Met? |
|---|---|
| All acceptance criteria are met | **No** — US-7.1 AC1 (client org / submission date, SCRUM-88's page), US-7.1 AC2's attachments clause, US-7.2 AC2/AC3 (SCRUM-91) |
| Manually tested against those ACs | **Partly** — every AC this branch owns was driven end-to-end against a real stack, but not by a human in a browser |
| Automated tested against those ACs | ⚠️ Unit for every pure rule (274 passing). Integration written for every database-dependent one, but the **AC3 cases added 2026-09-16 have not been executed** — no Docker in that session |
| Merged into main, existing functionality still works | **No** — branch only |
| Runs from the README instructions | ⚠️ `next build`, `tsc`, `eslint` clean on 2026-09-16; `db:start`/`next dev` last verified 2026-09-15, not re-run since the rebase |
| Merged and integrated into the Git | **No** |
| Code reviewed by someone other than the author | **No** — no PR |

Per CLAUDE.md there is no partial credit, so both stories should sit at
**"Merged - Pending Verification"** at best — and not even that until the
branch is actually merged and reviewed.

## Suggested next step

1. Open a PR referencing SCRUM-89 and SCRUM-90, listing the ACs and TCs above
   with their status, and get the peer review the DoD requires.
2. Have someone click through US-7.1-TC02, US-7.1-TC03 (the AC3 denial) and
   US-7.2-TC01/TC03 in a browser — the one DoD gate this session could not
   close.
3. **Run the integration suite against a real database** (`pnpm run db:reset`
   then the integration tests). The AC3 cases added on 2026-09-16 have never
   executed — no Docker in the session that wrote them.
4. Raise with the team: (a) that the test-case sheet's US-7.1 is missing
   SCRUM-89's AC3, which the Jira card does carry — another instance of the
   drift CLAUDE.md warns about, worth reconciling centrally;
   (b) that US-7.1 AC1 needs client org + submission date added to
   SCRUM-88's queue page, and `AssignedEvent` widened to carry them; (c) who
   owns SCRUM-91, without which US-7.2 cannot close; (d) that SCRUM-92's
   approve route still carries the same "assigned coordinator" gap in its own
   comment, which US-7.3 AC3 genuinely does ask for.
