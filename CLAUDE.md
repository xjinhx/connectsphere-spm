# CLAUDE.md

Guidance for Claude (or any AI coding assistant) working in this repository.

## Course context — read this first

This is a **graded Scrum project**. Process outweighs product: how the work
was done, traced, and explained matters as much as whether it runs. An
AI-generated solution the team can't explain themselves scores poorly, even
if it works. Week 13 is a **live trace from requirement to implementation**
— be able to point from a running feature back to its Jira card, its ACs,
and the commits/PRs that built it, in that order. Optimise for traceable,
explainable, small diffs over cleverness or working-but-opaque code.

## Project

**ConnectSphere** — an event management system for planning client events at
ConnectSphere-owned venues in Singapore. Modular monolith; web app and API
deploy together as one Next.js app.

Five roles per the customer briefing: Event Organiser, Event Coordinator,
Venue Staff, Technical Support Staff, Attendee.

**Event Operations Manager** appears in several story descriptions (e.g.
SCRUM-94) but is unresolved for Release 1 — most likely a permission on an
existing role rather than a sixth role. Do not model it as a distinct role
without confirming with the team first.

## Current sprint scope (Sprint 1)

**Release 1 scope and current sprint scope are not the same thing.** Release
1 is everything due by Week 12, covering ~20 functionality areas across all
sprints. The current sprint is a subset of that. Build only what the current
sprint covers.

**In the current sprint:** Authentication, Account Roles / User Profile,
Client Organisations, Event Request Creation, Draft Event Requests, Event
Review & Approval, Coordinator Assignment, Venue Catalogue.

**In Release 1 but NOT in the current sprint — do not build:** Event Status
Management, Venue Availability, Venue Search, Venue Suitability, Venue
Booking Request, Venue Booking Approval, Booking Conflict Detection,
Equipment Request / Availability / Reservation, Attendee Registration,
Notification System.

**Notification deserves specific mention.** Twilio SendGrid appears in the
tech stack below and some story ACs reference a user being "notified", but
there is no notification story in the current sprint. Do not add SendGrid
calls, email triggers or a notification queue speculatively. Where an AC
requires a notification, the minimum honest implementation is a record in
the data layer, and the limitation should be noted — not an email pipeline.

**Where an AC depends on something outside the current sprint** — a
Confirmed status, a venue booking, an equipment reservation — implement the
minimum that satisfies the criterion honestly, document the limitation, and
do not build the absent feature just to make a test exercisable. A test case
that passes only because the feature it guards against does not yet exist
should be flagged for re-execution in a later sprint, not treated as
verified.

This section is per-sprint and goes stale. If it has not been updated since
the last sprint planning, check the current sprint board in Jira rather than
trusting this list, and flag it.

## Tech stack

- **Frontend:** React 19 + TypeScript
- **API/Backend:** Next.js route handlers
- **Database:** Supabase (PostgreSQL)
- **Shared contract:** TypeScript types + Zod schemas
- **Email:** Twilio SendGrid — **not wired up in the current sprint**, see
  "Current sprint scope (Sprint 1)" above
- **Package manager:** pnpm (always use `pnpm`, never `npm`/`yarn`)
- **Language rules:** TypeScript strict mode — do not introduce `any` or
  unchecked possibly-undefined access
- **Testing:** Vitest + React Testing Library + Playwright
- **CI:** GitHub Actions
- **Hosting:** Vercel (app) + Supabase (database) — see "Supabase" below for
  the local vs. cloud distinction

## Folder structure (see `docs/architecture.md` for full detail)

```
src/domain/<feature>/   Pure business logic only — no framework/I-O code.
                        schema.ts (Zod schemas + types), policy.ts (pure
                        rule functions), service.ts (orchestrates I/O,
                        delegates actual calls to src/lib/).
src/lib/                Framework/infra glue: Supabase clients, env
                        validation, shared API error handling. Organized
                        by infra concern, not by feature.
src/components/<area>/  Reusable UI building blocks. Created the first
                        time a page needs a reusable piece — do not
                        pre-scaffold empty folders speculatively.
src/app/<route>/        Next.js App Router pages and API routes. Should
                        mostly be plumbing: call domain/ for logic, lib/
                        for infra, components/ for UI.
```

**Rule of thumb:** if you're about to write Supabase/fetch/Next.js code
inside `src/domain/`, stop — that belongs in `src/lib/` or `service.ts`,
called from `domain/`, not written directly there.

## Adding a new feature

1. Check the **Jira card first** for the exact acceptance criteria — see
   "Acceptance criteria: Jira is authoritative" below before consulting
   any spreadsheet.
2. `src/domain/<feature>/schema.ts` at minimum (Zod schema + inferred type).
3. Add `policy.ts` if the feature has permission/business rules.
4. Add `service.ts` for I/O, importing Supabase clients from `src/lib/supabase/`
   — never call Supabase directly from `domain/`.
5. Route under `src/app/api/<resource>/route.ts`, using `handleApiError()`
   from `src/lib/api/handler.ts`.
6. Tests under `tests/unit/`, matching official test case IDs from
   `ConnectSphere_Test_Cases_v3.xlsx` where they exist (e.g. `US-5.1-TC04`)
   — test case IDs and the story-to-SCRUM mapping are fine to take from
   this sheet, but the AC text they're testing against must match the
   Jira card, not the sheet, if the two disagree. See "Definition of
   Done" — automated tests are good practice here but are not, on their
   own, what closes out a story for this team.

## Acceptance criteria: Jira is authoritative, not the spreadsheet

`ConnectSphere_Test_Cases_v3.xlsx` holds test case IDs and the
story-to-SCRUM mapping, and is useful for that. **It is not authoritative
for acceptance criteria — Jira is.** The sheet's AC text has drifted from
Jira in places and is being reconciled; known examples: SCRUM-92 is
missing two of its three ACs in the sheet, and SCRUM-94 is missing both
the notification requirement and the entire concurrency criterion.

**Where the sheet and Jira disagree, Jira wins.** Do not implement
behaviour that isn't on the Jira card, even if the spreadsheet describes
it. If a sheet AC looks richer or more complete than what's on the Jira
card, that's the sheet being stale, not a hidden requirement to build to
— check Jira before writing code, not just before opening a PR.

## Contract-first workflow (important — read before touching shared schemas)

Many user stories are officially bundled together in Jira under one
consolidated story, even though they're separate SCRUM tickets. The
`ConnectSphere_Test_Cases_v3.xlsx` sheet "User Stories & ACs" shows this
story-to-SCRUM mapping (e.g. `US-5.1` = SCRUM-76+77+78) — useful for
seeing the grouping, but confirm the actual AC text against Jira per the
rule above. This means a schema like `event-request/schema.ts` is very
likely shared across multiple people's tickets, and epics are generally
intertwined rather than cleanly owned end-to-end by one person.

**Before creating a new `schema.ts` in an existing feature folder**, check
whether one already exists and extend it rather than creating a competing
file. If you're the first to touch a shared feature, treat the schema as a
proposal — flag in the PR description that others building sibling tickets
should extend this file, not duplicate it.

It's normal and expected to build and merge domain-layer logic (schema +
policy + tests against fixture data) before the full feature — the actual
API route, database write, and UI — exists. This does not, by itself, close
out the story; see "Definition of Done" below.

## Definition of Done

Agreed by the team (see team's DoD worksheet). This is what actually closes
a story — a story that doesn't meet this is **not** counted toward sprint
velocity, is not shown at Sprint Review, and returns to the Product Backlog.
**There is no partial credit** — a nearly-finished story scores zero for the
sprint, so be honest about status rather than optimistic.

| Criterion | Required? |
|---|---|
| All acceptance criteria are met | Yes |
| Manually tested against those acceptance criteria | Yes |
| Automated tested against those acceptance criteria | **No** |
| Merged into main and existing functionality still works | Yes |
| Runs from the README instructions | Yes |
| Merged and integrated into the Git | Yes |
| Code has been reviewed by someone other than the author | Yes |

Note the automated-testing row: unit/integration tests are good practice and
encouraged (and required where the story's dependencies allow it — see
"Contract-first workflow"), but they are not what the team's DoD checks —
**manual** testing against the actual acceptance criteria (as written in
Jira) is what's required. Don't treat a green `pnpm test` run as equivalent
to a story being done.

**Be precise about merged-code vs. done-story.** A ticket's own code being
merged is not the same as its official acceptance-criteria being met and
manually verified. Many stories require sibling tickets (sometimes in a
different epic) to exist before their ACs are even testable. When code is
merged but full AC verification is blocked on a dependency:

- Do not mark it "Done" — per the DoD above, it isn't, and there's no
  partial credit for it being close.
- Document explicitly, in the PR description and/or the Jira ticket, which
  acceptance criteria/test cases are blocked and what they're waiting on.
- The board has a status for exactly this: **"Merged - Pending Verification"**
  (category: In Progress) — between "In Review" and "Done." Move a ticket
  here, not to "Done," until it's actually been manually tested against
  every AC and genuinely meets the table above.

## Supabase — local vs. cloud (read before running any `db:*` script or `supabase` command)

This project has **two separate Supabase instances** that are easy to
conflate:

1. **Local** (Docker, via the CLI) — `pnpm run db:start` / `db:stop` /
   `db:reset`. This is where day-to-day development and migrations have
   been happening. Studio UI at `http://localhost:54323`. Each developer's
   local instance is their own separate copy, built from the same
   migration files — not shared data.
2. **Cloud** (`connectsphere-spm`, `main` branch, marked **PRODUCTION** in
   the Supabase dashboard) — first migration (`profiles` table with
   `roles`, SCRUM-206) has been pushed here with team agreement. Treat any
   further cloud push the same way: confirm with the team first, it's
   labeled PRODUCTION and affects everyone.

Migration files live in `supabase/migrations/`, applied in filename
(timestamp) order. Check `src/lib/supabase/database.types.ts` — it's
generated from the local schema via `pnpm run db:types` and should be
regenerated after any migration that changes the schema.

To push a new migration to cloud once the team's agreed: `pnpm supabase
login` → `pnpm supabase link --project-ref <ref>` → `pnpm supabase db push
--dry-run` to review → `pnpm supabase db push` to apply.

## Git workflow

- Branch off an up-to-date `main` (`git fetch origin && git pull origin main`
  first, then `git checkout -b <branch> main`).
- One feature/ticket per branch, named descriptively (e.g.
  `event-request-attendance`, not `scrum-78`).
- PR required for everything — at least 1 approving review before merge
  (see Definition of Done: reviewed by someone other than the author). No
  direct pushes to `main`.
- Reference the SCRUM ticket ID in the PR title/description. If a PR is a
  starting proposal for a shared file (e.g. a schema others will build on),
  say so explicitly in the description.
- Because branch names deliberately carry no ticket key, commit messages and
  PR titles are the **only** link between the Sprint Backlog and the code.
  Prefix every commit `SCRUM-<key>:` without exception, and prefer one commit
  per acceptance criterion over one per working session — it makes the Week 13
  requirement-to-code trace a matter of pointing at a commit rather than
  scrolling a diff.
- In the PR description, list the story's acceptance criteria (as written in
  Jira) and the test case IDs covering each. This is the traceability
  evidence, and it is far cheaper to write while the work is fresh.
- Do not rewrite or force-push shared `main` history without explicit
  team-wide agreement — even for something as minor as fixing a commit's
  author email. It's rarely worth the coordination cost; if unsure, leave
  history as-is and move forward correctly from that point on.

## Team

**Every story in the current sprint has a named assignee in Jira. Do not
implement, refactor or scaffold a story assigned to someone else, even if it
blocks the work in hand — say so and stop.** Silently building another
person's story causes merge conflicts and distorts the intra-team peer review.

**Exception:** proposing a shared schema/contract for a sibling ticket under
the same consolidated story (see "Contract-first workflow" above) is allowed
and expected, provided it's flagged explicitly in the PR description and the
assignee hasn't already started their own version. This is proposing a
shape for someone else to build against — not implementing their story's
actual logic, policy rules, or routes for them. If in doubt whether a given
change crosses that line, say so and stop, same as above.

Scrum roles rotate between sprints, and epics are intertwined rather than
cleanly owned end to end, so don't assume long-term ownership of an area —
but do respect current Jira assignment.

Contributors:

- **marcusliow** (Marcus Liow) — contributor
- **joshuayeo2024** (Joshua Yeo) — contributor
- **wennnzly** (Arwen Alyssa Tan) — contributor
- **hdylangit** (Dylan Huang) — contributor
- **xjinhx** (He Jinhong) — contributor
- **ytng05** (Ng Yee Teng) — contributor

Check in with whoever is already active on a shared file (see "Contract-first
workflow") rather than assuming ownership of it.

## Where to look things up

- **Jira** — authoritative source for acceptance criteria and story scope.
  Check the card before writing code, not just before opening a PR.
- `docs/architecture.md` — folder convention, current build status per layer.
- `ConnectSphere_Test_Cases_v3.xlsx` — test case IDs and the story-to-SCRUM
  mapping (sheet "User Stories & ACs" shows which SCRUM numbers are bundled
  into which consolidated story). Its AC text is being reconciled against
  Jira and should not be treated as authoritative — see "Acceptance
  criteria: Jira is authoritative" above. Some ACs/test cases are in
  "DRAFT" sheets — flagged as unvalidated, confirm with the team before
  treating as final.
- `connectspherec4.drawio` — C4 architecture diagram (context, containers,
  API components, web components), covering Release 1 (EP-01 to EP-20). Note
  this is **Release 1**, not the current sprint — it intentionally models
  more than any one sprint builds.
- Jira backlog — full product backlog (~200 items across ~58 epics) covers
  far more than any single sprint's scope; check the current sprint board for
  what's actually active, and see "Current sprint scope" above for what's in
  versus out.
