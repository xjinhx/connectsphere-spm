# SCRUM-76 / 77 / 82 — integration plan after Authentication merged

Written 2026-09-12, after merging `origin/main` (up to PR #15) into `event-request`.
Investigation only — no code has been changed. Decisions D1–D3 below are needed
before any of the actions start.

---

## 1. Where things stand

**Merged into main since these stories were built**

| PR / commit | What | Effect on 76/77/82 |
|---|---|---|
| #14 Authentication | Login page, Supabase session cookies, `middleware.ts` route protection, `pnpm seed:users` test accounts | Sessions now exist. Every route except `/login` requires one; `/api/*` returns 401 JSON without one. |
| #10 completed-event-request | SCRUM-82 | 82 is in main. |
| c969919 | SCRUM-78 attendance input on the form | Removes the "always incomplete on Expected attendance" blocker — 82's TC01 is now executable once the actor works. |
| 9930cd6 | SCRUM-83/85 drafts and resume | Adds more callers of the same actor seam. |
| #15 casing | `draft`/`submitted`, `am`/`pm`/`night` everywhere | Consistent across code, migrations and tests. |

**Health:** `tsc` clean, 134 unit tests pass across 11 files.

## 2. Findings

### F1 — `getCurrentActor()` is still the throwing stub (blocker)

`src/lib/auth/currentActor.ts` was written as the seam for the Authentication
story to fill in. The Authentication PR built login and route protection but
did not implement it. It is called from **nine** functions in
`src/domain/event-request/service.ts` (76, 77, 82, 83, 85).

Consequence today: an Event Organiser logs in, is redirected to `/events`
(`ROLE_LANDING_PATH.event_organiser`), which calls `listMyEventRequests()` →
`getCurrentActor()` → throws. **The organiser's first page after login is an
error.** Every event-request page and API behaves the same way.

What is available to build it from:
- `createSessionClient()` in `src/lib/supabase/server.ts` → `auth.getUser()`
- `profiles` table: `id` (= `auth.users.id`), `full_name`, `roles text[]`
- `Role` type and `isRole()` in `src/domain/identity/roles.ts`

Note: `pnpm seed:users` does **not** set `full_name`, so the implementation
must fall back (e.g. to the email) rather than assume it is present.

### F2 — Client Organisations has not landed (blocks 76 AC1, and creation entirely)

No table, no column on `profiles`, no code. But two things hard-depend on it:

- `event_request.client_organisation_id` is `NOT NULL` (76's migration).
- `requireOrganiser()` in the service throws a `ValidationError` when
  `actor.clientOrganisation` is null.

So even with F1 fixed, an organiser **cannot create a request**. 76's AC1
("form opens with my client organisation pre-filled") cannot be met until the
Client Organisations story exists; everything else in 76/77/82 can be, if the
NOT NULL is relaxed in the interim.

### F3 — Middleware already covers our routes

`src/middleware.ts` protects everything except `/login`. Our pages and
`/api/event-requests/*` are therefore behind auth with no change on our side.
Nothing to do here.

### F4 — In-place edit of applied migrations (check only)

PR #15 changed the enum values inside `20260911120000_event_request_submit.sql`
and the slot constraint inside `20260911130000_...` rather than adding a new
migration. Safe for local databases (`db reset` rebuilds them). It is only a
problem if either file had been pushed to the cloud project with the old
values. CLAUDE.md says only the profiles migration has been pushed — confirm
that before any cloud push.

### F5 — Test coverage is unaffected

All 76/77/82 unit tests still pass after the merge and the casing change.
What changes is which manual test cases become executable (see §5).

## 3. Decisions needed

**D1 — Who implements `getCurrentActor()`?**
It sits in the Authentication story's area (`src/lib/auth/`) and its absence
breaks the Authentication story's own landing page for organisers. CLAUDE.md
says not to implement another person's story. Options:

- (a) Ask the Authentication owner to implement it — it is ~20 lines of glue.
- (b) Implement it on `event-request` with their explicit OK, since our stories
      are the only consumers today and the shape is already agreed (`Actor`).

*Recommendation: (a) first, same day; fall back to (b) if they agree.*

**D2 — What to do about `client_organisation_id` until Client Organisations lands?**

- (a) Wait. 76/77/82 stay un-runnable end to end; risk to the sprint.
- (b) Interim relaxation: make the column nullable, let `Actor.clientOrganisation`
      be null without throwing, and have the form show "Not yet linked to an
      organisation" in place of the pre-filled name. 76 AC1 is documented as
      blocked; everything else becomes testable. Reinstate NOT NULL (with a
      backfill) when Client Organisations lands.

*Recommendation: (b). It is the "minimum that satisfies the criterion honestly,
documenting the limitation" that CLAUDE.md asks for. The column is 76's own.*

**D3 — Cloud push of the event-request migrations.**
Three migrations (76, 82, 77) plus any from D2 have never been pushed to the
cloud project. It is labelled PRODUCTION; CLAUDE.md requires team agreement
first. Local Supabase (Docker) is enough for manual verification, so this can
wait until the PRs are reviewed.

## 4. Actions, in order

| # | Action | Depends on | Owner |
|---|---|---|---|
| A1 | Implement `getCurrentActor()`: session → `profiles` → `Actor`; unauthenticated → `UnauthenticatedError`; `fullName` falls back to email; `clientOrganisation: null` until Client Organisations | D1 | per D1 |
| A2 | Migration: `alter table event_request alter column client_organisation_id drop not null` with a comment naming the story that reinstates it | D2 | you (SCRUM-76) |
| A3 | Service: `requireOrganiser()` returns the organisation *or null* instead of throwing; insert passes null | D2 | you (SCRUM-76) |
| A4 | Form + new-request page: organisation field shows "Not yet linked to an organisation" when null; AC1 note in the 76 test-file header updated | D2 | you (SCRUM-76) |
| A5 | Start Docker → `pnpm db:reset` → `pnpm seed:users` → `pnpm dev` → log in as `organiser@example.com` | A1–A4 | you |
| A6 | Manual verification pass (see §5) and record results in the test-case sheet | A5 | you |
| A7 | Jira: 76, 77, 82 → **Merged – Pending Verification** until A6 is done; note the blocked ACs | — | you |
| A8 | Confirm F4 (no cloud push of the edited migrations) before any `supabase db push` | — | team |

Estimated size: A1 ~20 lines; A2–A4 ~30 lines total; A5–A6 is the real work.

## 5. What becomes manually verifiable, and what stays blocked

| Story | Executable after A1–A5 | Still blocked | Blocked on |
|---|---|---|---|
| SCRUM-76 | AC2 unique reference · AC3 past date · AC4 no lead time · AC5 Singapore time · TC01 · TC05 | **AC1** org pre-filled | Client Organisations |
| SCRUM-77 | AC1 · AC2 · AC3 · AC4 · TC02 · TC03 | — | — |
| SCRUM-82 | TC01 · TC02 · TC03 · TC05 · AC1 status/timestamp · AC2 · AC3 · AC4 | **TC04** Ops Manager queue view | Coordinator Assignment story; Event Operations Manager role unresolved |

## 6. Out of scope for us

- The Client Organisations story itself.
- The assignment-queue page (Coordinator Assignment) and the Ops Manager role.
- Anything in `src/domain/identity/` beyond reading roles.
