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
SCRUM-94) but not among the briefing's five. The team has since modelled it
as a role, `operations_manager` (`src/domain/identity/roles.ts`), which holds
coordinator assignment and account role management in SCRUM-69's permission
matrix — customer clarification #52 leaves user administration for the team
to propose. Use that role; don't add another admin-style role without agreeing
it with the team first.

## Current sprint scope (Sprint 3, 8 Oct – 21 Oct 2026)

**Sprint goal:** "ConnectSphere books venues the way the customer actually
runs them — to the quarter-hour, with setup and turnaround time protected,
holds that expire, and a replacement path when a venue falls through — so that
no Release 1 work is still being built on AM/PM/Night slots."

21 stories, 67 points, plus 2 bug tickets (no points). Product Owner: Arwen
(from Joshua). 49 of the 67 points are the Week 7 customer changes, which are
the sprint goal and are never dropped.

**Release 1 scope and current sprint scope are not the same thing.** Release
1 is everything due by Week 12, now 26 core features (the 20 from Week 4 plus
the six Week 7 changes), one epic each. The current sprint is a subset of
that. Build only what the current sprint covers.

**In the current sprint** (the Jira sprint board is the list of record; where
an area has other stories in the backlog, only the ones named here are in):

- Lane 1 — Time model (critical path): SCRUM-238 request times in 15-minute
  steps, SCRUM-239 venue hours, availability, calendar and search in
  15-minute ranges, SCRUM-226 setup and turnaround treated as committed
- Lane 2 — Venue config, holds and suitability: SCRUM-225, 227, 228, 135, 136
- Lane 3 — Multi-venue, replacement and booking request: SCRUM-230, 231, 229,
  236, and SCRUM-142 (reopened: one AC was never met, so it was not Done)
- Lane 4 — Lifecycle, roles and notifications: SCRUM-234 Operational Safety
  Check, SCRUM-232 and 233 Event Coordinator Lead, SCRUM-197 assignment
  notifications
- Lane 5 — Equipment and readiness: SCRUM-240 equipment catalogue, SCRUM-160,
  164, 100
- Bugs: SCRUM-237 (SCRUM-142) and SCRUM-241 (SCRUM-193), each with the owner of
  the story it was found in

**Stretch, in this order:** SCRUM-167, then 109, then 110. **Drop order,
decided at the day-8 checkpoint:** SCRUM-135 and 136, then 236, then 164.

**The 15-minute booking unit** (Week 7 change 1, customer #126, #128) replaces
AM/PM/Night slots. Do not write new code against slots. The stories already
Done on slots stay Done (Week 7 guide, scenario 2); the switch is new work in
SCRUM-238/239. Old slots map to AM 07:00–12:00, PM 13:00–18:00,
Night 19:00–24:00. Times are Singapore clock times on :00, :15, :30 or :45,
validated with the shared `ClockRangeSchema` (`src/domain/shared/times.ts`).
Ranges are half-open: a booking ending 12:00 does not clash with one starting
12:00. ACs rewritten for minutes are marked "pending #131".

**Agreed on day 1:**

- One migration for the time model: clock times instead of slots and venue
  setup/turnaround columns defaulting to 0. Don't add a second migration
  touching the same tables without agreeing it with Lanes 1 and 3 first.
- Availability goes through `getVenueCommitments(venueId, start, end)` in
  `src/domain/availability/service.ts`. Call it; don't write your own overlap
  check. Until the real query lands (day 4) it is a stub (D-16), so a PR that
  calls it is `uses-dummy`.
- "Committed", not "occupied": a period taken by a confirmed booking, an active
  hold, an unavailable period, or setup/turnaround around a booking. Venue
  Staff see which event holds a clash (SCRUM-155 AC1); coordinators see only
  the period.
- Event Coordinator Lead is a display name only (customer #129): the role in
  code stays `operations_manager`.
- Interim rules pending the customer: a safety rejection records the reason
  and returns the event to Planning, not Cancelled (#130); a venue opening at
  08:00 with 30 minutes' setup has an earliest start of 08:30 (recorded on
  SCRUM-239).

**Built in Sprints 1 and 2:** Authentication, Account Roles / User Profile,
Client Organisations, Event Request Creation, Draft Event Requests, Event
Review & Approval, Coordinator Assignment, Venue Catalogue, Venue Booking
Approval, Booking Conflict Detection, Venue Availability, Venue Search, Event
Status Management, in-app notifications. Fix bugs in them (see "Bugs");
extend them only through a story.

**In Release 1 but NOT in the current sprint — do not build:** Attendee
Registration, change requests, event information changes and impact review
(SCRUM-109 to 111, unless pulled in as stretch), equipment availability and
reservation beyond the catalogue (SCRUM-166, 167, 170, 173, 175, 177, unless
SCRUM-167 is pulled in as stretch), email notifications.

**Scrum Master:** Dylan takes no user stories this sprint and reviews all
PRs. First review within 24 hours, by anyone other than the author. If PRs
pile up near the end of the sprint, whoever is free helps, coordinating with
him.

**Working agreements carried from the retro:** first PR by day 3, half the
points merged by day 8. Branch from `main` rather than stacking PRs. Claim
dummy numbers on Slack. Use a current timestamp for migrations and never rename
one on `main`; run `npm run db:reset` after pulling new migrations. Check the
customer forum every two days. Update Jira the day a PR merges. Add test cases
for rewritten ACs to your own test tab before building.

**Notification** stays in-app only. No card in this sprint mentions email, so
Twilio SendGrid stays out: do not add SendGrid calls or email triggers. Where
an AC says someone is notified, create the notification through the existing
in-app mechanism (SCRUM-193/198). Dummies replaced this sprint, as part of the
story that waits on them: D-06 by SCRUM-197, D-12 and D-15 by SCRUM-231.

**Where an AC depends on something outside the current sprint** — an
equipment reservation, an attendee registration — implement the
minimum that satisfies the criterion honestly, record it as a dummy in
`docs/dummies.md` (see "Dependencies on other people's stories" under Team),
and do not build the absent feature just to make a test exercisable.

Whether a test against that minimum counts depends on whether it actually
exercises the behaviour:

- **It runs the behaviour → it counts.** e.g. SCRUM-92: an approved request
  really does show that nothing is committed. The AC is tested, and the dummy
  entry says to re-run it once bookings exist.
- **It has nothing to run against → it doesn't count.** e.g. in Sprint 1,
  before the stand-in `venue_booking` table existed, SCRUM-120's "list the
  bookings a capacity cut would affect": with no bookings table there could
  never be any, so the check proved nothing. That AC stayed untested, and the
  story stayed in Merged - Pending Verification.

This section is per-sprint and goes stale. If it has not been updated since
the last sprint planning, check the current sprint board in Jira rather than
trusting this list, and flag it.

## Tech stack

- **Frontend:** React 19 + TypeScript
- **API/Backend:** Next.js route handlers
- **Database:** Supabase (PostgreSQL)
- **Shared contract:** TypeScript types + Zod schemas
- **Email:** Twilio SendGrid — **not wired up in the current sprint**, see
  "Current sprint scope" above
- **Package manager:** npm. CI and the README use it, and `package-lock.json`
  is the only lockfile. Don't use pnpm or yarn.
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
2. **Check for dummies waiting on this story:** run
   `git grep "DUMMY(SCRUM-<key>"` and read `docs/dummies.md`. Replacing any
   dummy that waits on this story is part of this story's work — see
   "Dependencies on other people's stories" under Team.
3. `src/domain/<feature>/schema.ts` at minimum (Zod schema + inferred type).
4. Add `policy.ts` if the feature has permission/business rules.
5. Add `service.ts` for I/O, importing Supabase clients from `src/lib/supabase/`
   — never call Supabase directly from `domain/`.
6. Route under `src/app/api/<resource>/route.ts`, using `handleApiError()`
   from `src/lib/api/handler.ts`.
7. Tests under `tests/unit/`, matching official test case IDs from
   `ConnectSphere_Test_Cases_v3.xlsx` where they exist (e.g. `US-5.1-TC04`)
   — test case IDs and the story-to-SCRUM mapping are fine to take from
   this sheet, but the AC text they're testing against must match the
   Jira card, not the sheet, if the two disagree. See "Definition of
   Done" — automated tests are good practice here but are not, on their
   own, what closes out a story for this team. From Sprint 2, each
   developer keeps their stories' test cases in their own Excel file (the
   Week 4 template, one tab per story, numbered T1, T2…), consolidated into
   one at sprint end; the v3 sheet keeps Sprint 1's IDs.

## Acceptance criteria: Jira is authoritative, not the spreadsheet

`ConnectSphere_Test_Cases_v3.xlsx` holds test case IDs and the
story-to-SCRUM mapping, and is useful for that. **It is not authoritative
for acceptance criteria — Jira is.** The sheet's AC text has drifted from
Jira in places and is being reconciled. Known examples: the sheet bundles
tickets into consolidated stories and renumbers their ACs — US-7.3
(SCRUM-92 + 93) and US-8.1 (SCRUM-94 + 95 + 96) both number ACs differently
from the Jira cards — and older copies of the sheet are missing SCRUM-92's
AC2 and AC3 and SCRUM-94's notification and concurrency criteria. Check which
version you have.

**Where the sheet and Jira disagree, Jira wins.** Do not implement
behaviour that isn't on the Jira card, even if the spreadsheet describes
it. If a sheet AC looks richer or more complete than what's on the Jira
card, that's the sheet being stale, not a hidden requirement to build to
— check Jira before writing code, not just before opening a PR.

## Changing acceptance criteria and test cases

Discovering a new acceptance criterion, or changing test cases, is normal and
allowed **as long as it doesn't change the story-point estimate** — a story
estimated at 4 must not become a 6 (professor consultation, 15 Sep 2026).

**Finish the story as estimated; new work becomes a new story.** User stories
are not tied to sprints. If a story with 8 fields can be completed this
sprint, and halfway through you find it also needs validation logic or a 9th
field, don't grow the current story: complete the 8 fields now, and create a
new user story for the 9th field or the validation, for a future sprint.

- **Changes that add no work** (rewording an AC, correcting a test case,
  adding a test case for behaviour already in scope): update the Jira card and
  `ConnectSphere_Test_Cases_v3.xlsx` together so they don't drift further,
  agree it in the daily standup, add a row to the team tracker's Change Log,
  and note it in the PR description.
- **Changes that add work** (a new field, new validation logic): create a new
  user story for a later sprint instead of widening the current one.
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

Agreed by the team — the source is the **Definition of Done** tab in the team
tracker (`IS212_Tracker_W4`); keep the two in step. This is what actually closes
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
| Merged and integrated into the Git | Yes |
| Code has been reviewed by someone other than the author | Yes |
| Required Jira/Slack updates, decisions and evidence recorded in the agreed locations | Yes |

Note the automated-testing row: unit/integration tests are good practice and
encouraged (and required where the story's dependencies allow it — see
"Contract-first workflow"), but they are not what the team's DoD checks —
**manual** testing against the actual acceptance criteria (as written in
Jira) is what's required. Don't treat a green `npm test` run as equivalent
to a story being done.

**Manual testing does not need a screen.** Testing a story through its
function or API — for example a request made with a signed-in session and
checked against the stored row — counts as manual testing against its
acceptance criteria. A backend-only story is not held back from Done just
because no page shows it yet (professor consultation, 15 Sep 2026).

**Sprint 2 working agreement: test before the PR.** Before raising a PR, run
every automated and manual test case for the story and upload the evidence to
the Jira ticket: screenshots pasted into a comment (not attached, so they can
be annotated), each labelled with its AC and test case number (e.g. AC1 T1).
This is a team agreement, not a DoD change — the table above stays as it is
until the tracker's Definition of Done tab says otherwise.

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
  even with a dummy — including a check with nothing to run against (see
  "Where an AC depends on something outside the current sprint"). Document in
  the PR description and/or the Jira ticket which acceptance criteria/test
  cases are blocked and what they're waiting on, and move the ticket to Done
  once they have been tested.
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
- **CI fails after a merge:** the developer who owns the story fixes it; the
  Scrum Master flags it to them (Sprint 2 agreement).
- **A major bug that needs the story rewritten** becomes a user story for the
  next sprint rather than a fix.
- If a bug is fixed in a story that was already Done, be ready to explain,
  when the fix is merged, why its test cases didn't catch it.
- Name bugs and blockers in the daily standup with the time they cost
  (e.g. "lost half a day on X because of Y").

## Supabase — local vs. cloud (read before running any `db:*` script or `supabase` command)

This project has **two separate Supabase instances** that are easy to
conflate:

1. **Local** (Docker, via the CLI) — `npm run db:start` / `db:stop` /
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
generated from the local schema via `npm run db:types` and should be
regenerated after any migration that changes the schema.

Creating or changing tables doesn't need a user story of its own — any story
that needs a table or column may add it (see "Dependencies on other people's
stories" under Team). The team plans an ER diagram and data dictionary; once
they exist, update them in the same PR as the migration.

To push a new migration to cloud once the team's agreed: `npx supabase
login` → `npx supabase link --project-ref <ref>` → `npx supabase db push
--dry-run` to review → `npx supabase db push` to apply.

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
  evidence, and it is far cheaper to write while the work is fresh. The PR
  template (`.github/pull_request_template.md`) prompts for this, for any
  dummy added or replaced, and for the git checks — fill it in rather than
  deleting it.
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
   - mark every place it lives with the same marker, naming what it waits on
     and its register entry: `// DUMMY(SCRUM-<key>) D-<nn>: <what is faked>`.
     Use `DUMMY(`, never `TODO(`, so a search can't confuse it with an
     ordinary TODO. If no story exists yet, use the epic's key (e.g.
     `DUMMY(SCRUM-24)` for the Notification System);
   - add an entry to `docs/dummies.md` in the same PR — the register of every
     dummy: what it fakes, where it lives, what it waits on, and how to
     replace it;
   - add the `uses-dummy` label to your Jira ticket and an "is blocked by"
     link to that story, so the board shows it too.

   If your acceptance criteria pass against the dummy, your story is Done and
   does not carry over. When the story it waits on is built in a later sprint,
   that story swaps the dummy out as part of its own work (step 2 of "Adding a
   new feature"): it follows the entry's replacement steps, re-runs the tests
   of the story that added the dummy, removes the markers, and marks the entry
   **Replaced**. Entries are never deleted — they are the history.
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
- `docs/dummies.md` — the register of every dummy: what each one fakes, where
  its `DUMMY(...)` markers are, what it waits on, and how to replace it.
- `CONTEXT.md` — the team glossary: one word per concept (e.g. "unavailable
  slot", not "blocked slot"). Use its terms in code; Jira still wins on what an
  AC requires. Add a term when the team settles what a word means.
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
