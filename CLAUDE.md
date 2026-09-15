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

## Changing acceptance criteria and test cases

Finding a missing acceptance criterion or test case mid-story is normal, and
changing them is allowed **as long as the story-point estimate barely moves**
(professor consultation, 15 Sep 2026). A change that would push a 4-point
story to 6 is too big for the current story.

- **Small change** (e.g. one more field): update the Jira card and
  `ConnectSphere_Test_Cases_v3.xlsx` together so they don't drift further,
  agree it in the daily standup, add a row to the team tracker's Change Log,
  and note it in the PR description.
- **Bigger change** (e.g. new validation logic): leave the current story as
  estimated and create a new user story for a later sprint. User stories are
  not tied to sprints.
- **One story or two?** A story that bundles two functions must test both.
  Split it unless it is plain CRUD on one thing, and be able to explain why it
  is one story rather than two.

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

**Manual testing does not need a screen.** Testing a story through its
function or API — for example a request made with a signed-in session and
checked against the stored row — counts as manual testing against its
acceptance criteria. A backend-only story is not held back from Done just
because no page shows it yet (professor consultation, 15 Sep 2026). The team's
source for the table above is the **Definition of Done** tab in the team
tracker (`IS212_Tracker_W4`); keep the two in step.

**Proposed additions — not yet agreed.** These are proposed for the team to
vote on. Do not apply them as part of the DoD until the tracker's Definition
of Done tab is updated:

- Every test case for **that Jira ticket's** acceptance criteria passes. Scope
  it to the ticket, not the whole consolidated story on the test sheet —
  US-8.1 bundles SCRUM-94, 95 and 96, so "every test case on the sheet" would
  keep SCRUM-94 from being Done while reassignment is unbuilt.
- No open bug tickets are logged against it (see "Bugs" below).
- Git checks: testing is finished on the branch, and `main` has been merged in
  with any conflicts resolved before review.

**Board statuses:** To Do → In Progress → In Review → Merged - Pending
Verification → Done.

**Be precise about merged-code vs. done-story.** A ticket's own code being
merged is not the same as its acceptance criteria being met and manually
verified. When a story's ACs depend on a sibling ticket that doesn't exist
yet, try a dummy first (see "Dependencies on other people's stories" under
Team):

- If every acceptance criterion passes against a dummy, the story **is Done**
  and does not carry over to the next sprint.
- **"Merged - Pending Verification"** (category: In Progress, between "In
  Review" and "Done") is only for acceptance criteria that cannot be tested
  even with a dummy. Document in the PR description and/or the Jira ticket
  which acceptance criteria/test cases are blocked and what they're waiting
  on, and move the ticket to Done once they have been tested.
- Never mark a story Done while any of its acceptance criteria is untested —
  there's no partial credit for it being close.

## Bugs

Bugs are normal, and fixing them inside a sprint is part of the process, not a
sign it is failing (professor consultation, 15 Sep 2026).

- **Found in merged or reviewed code:** log a Jira Bug ticket, big or small —
  steps to reproduce, expected vs actual, linked to the story it came from.
  No story points. This is tracking evidence: the examiners may ask what
  unexpected problems came up.
- **Found in your own branch before the PR:** just fix it; no ticket.
- **A major bug that needs the story rewritten** becomes a user story for the
  next sprint rather than a fix.
- If a bug is fixed in a story that was already Done, be ready to explain,
  when the fix is merged, why its test cases didn't catch it.
- Name bugs and blockers in the daily standup with the time they cost
  (e.g. "lost half a day on X because of Y").

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

Creating or changing tables doesn't need a user story of its own — any story
that needs a table or column may add it (see "Dependencies on other people's
stories" under Team). The team plans an ER diagram and data dictionary; once
they exist, update them in the same PR as the migration.

To push a new migration to cloud once the team's agreed: `pnpm supabase
login` → `pnpm supabase link --project-ref <ref>` → `pnpm supabase db push
--dry-run` to review → `pnpm supabase db push` to apply.

## Git workflow

- Branch off an up-to-date `main` (`git fetch origin && git pull origin main`
  first, then `git checkout -b <branch> main`).
- One feature/ticket per branch, named descriptively (e.g.
  `event-request-attendance`, not `scrum-78`).
- **Push your branch and merge `main` into it at least every 2 days** while
  work is in progress. Small, frequent merges keep conflicts small (professor
  consultation, 15 Sep 2026).
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
implement, refactor or scaffold another person's story — their business
rules, routes or UI — even if it blocks the work in hand.** Silently building
another person's story causes merge conflicts and distorts the intra-team peer
review. Don't push commits to someone else's PR branch either, even to fix a
comment; suggest the change in your review instead, so the work stays reviewed
by someone other than its author.

**Exception:** proposing a shared schema/contract for a sibling ticket under
the same consolidated story (see "Contract-first workflow" above) is allowed
and expected, provided it's flagged explicitly in the PR description and the
assignee hasn't already started their own version. This is proposing a
shape for someone else to build against — not implementing their story's
actual logic, policy rules, or routes for them. If in doubt whether a given
change crosses that line, say so and ask before going further.

### Dependencies on other people's stories

A dependency is not, by itself, a reason to stop (professor consultation,
15 Sep 2026). In order of preference:

1. **Shared tables belong to no single story.** If a table or column will
   exist eventually and your story needs it too, your story may create it
   rather than wait for the other story. Creating tables doesn't need a user
   story of its own. Say so in the PR description.
2. **Use a dummy for someone else's logic.** Where an acceptance criterion
   relies on a function from another story that isn't built yet (e.g. auth),
   write a placeholder in your own code and test your story against it:
   - shape it the way the real thing will be called — in this codebase auth
     is the function `getCurrentActor()`, so a dummy should look like that
     function — so the later swap is a one-line change;
   - mark it `TODO(SCRUM-<key>)`, naming the story that will replace it;
   - add the `uses-dummy` label to your Jira ticket and an "is blocked by"
     link to that story.

   If your acceptance criteria pass against the dummy, your story is Done and
   does not carry over. When the real code is built in a later sprint, that
   work swaps the dummy out, re-runs the integration test, and records the
   change in the team tracker's Change Log.
3. **Stop only when a dummy would make the test meaningless** — for example,
   complex validation owned by someone else, where faking it means the test
   proves nothing. Then say what is missing and whose story owns it.

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
- **Team tracker** (`IS212_Tracker_W4`, Google Sheets) — the management
  overview. Its rule: anything with story points lives in Jira; anything that
  is a date, a decision or a piece of evidence lives in the tracker. Tabs
  include Definition of Done (the source for the DoD above), Meeting Tracker
  (decisions and actions) and Change Log (one row per requirement change —
  append, never overwrite).
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
