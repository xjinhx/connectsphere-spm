# ConnectSphere Event Management System

IS212 Software Project Management, AY 2026/27 Term 1

ConnectSphere plans client events at ConnectSphere-owned venues in Singapore:
event requests, venue booking, equipment, attendee registration and change
requests, across the five roles in the customer briefing plus the two added in
Week 7: the Event Coordinator Lead and the Safety Officer. Release 1 was
delivered over four Sprints and went live on 04/11/2026.

| | |
|---|---|
| Live site | https://connectsphere-spm.vercel.app |
| Jira | https://scrumers-is212.atlassian.net (project `SCRUM`); exported to `1_Product_Backlog` |
| Repository | https://github.com/xjinhx/connectsphere-spm |
| Section | G9 |
| Team | 2 |

---

## Try it

Log in on the live site with any account below. The password for all of them
is `TestPass123!`.

| Role | Email |
|---|---|
| Event Organiser | `organiser@example.com` |
| Event Coordinator | `coordinator@example.com` |
| Event Coordinator Lead | `ops-manager@example.com` |
| Venue Staff | `venue-staff@example.com` |
| Technical Support Staff | `tech-support@example.com` |
| Attendee | `attendee@example.com` |
| Safety Officer | `safety-officer@example.com` |

The event **Demo Launch Night** (client Demo Client Pte Ltd) was taken through
the whole lifecycle on the live site by the team, one role at a time.

---

## Release 1: the 26 core features

F01–F20 are the 20 core features in the Week 4 project instructions. F21–F26
came from the six requirement changes the customer issued in Week 7
(02/10/2026); each is recorded in `ConnectSphere Change Log.docx` in the
submission folder `4_Sprint_Evidence`. One Jira epic per feature. All are Done.

| # | Feature | Epic |
|---|---|---|
| F01 | User Authorisation & Authentication | SCRUM-5 |
| F02 | Event Request Creation | SCRUM-6 |
| F03 | Draft Event Requests | SCRUM-7 |
| F04 | Event Review & Approval | SCRUM-8 |
| F05 | Coordinator Assignment | SCRUM-9 |
| F06 | Event Status Management | SCRUM-10 |
| F07 | Event Information Management | SCRUM-11 |
| F08 | Venue Catalogue | SCRUM-12 |
| F09 | Venue Availability Calendar | SCRUM-13 |
| F10 | Venue Search & Filtering | SCRUM-14 |
| F11 | Venue Suitability Checking | SCRUM-15 |
| F12 | Venue Booking Request | SCRUM-16 |
| F13 | Venue Booking Approval | SCRUM-17 |
| F14 | Booking Conflict Detection | SCRUM-18 |
| F15 | Equipment Request Management | SCRUM-19 |
| F16 | Equipment Availability Checking | SCRUM-20 |
| F17 | Equipment Reservation | SCRUM-21 |
| F18 | Attendee Registration | SCRUM-22 |
| F19 | Event Change Requests | SCRUM-23 |
| F20 | Notification System | SCRUM-24 |
| F21 | Tentative Venue Holding | SCRUM-38 |
| F22 | Setup and Turnaround Time | SCRUM-39 |
| F23 | Venue Unavailability Management | SCRUM-40 |
| F24 | Operational Safety Check | SCRUM-224 |
| F25 | Multiple Venues for One Event | SCRUM-242 |
| F26 | Event Coordinator Lead | SCRUM-243 |

Everything after Release 1 sits in one epic, SCRUM-263, and is not built.

**Known limits in Release 1**

- Notifications are in-app only. Email was moved out of Release 1 (CL-49).
- Approving a change request (SCRUM-190) was built and tested through its API,
  which the Definition of Done allows for backend work.

---

## Tracing a requirement to code

Every commit starts with its Jira key, so any story can be followed from card
to code. Example, **SCRUM-102** (confirm an event):

1. **Jira card** (export in `1_Product_Backlog`): the acceptance criteria. The
   test cases and results for each AC are in `3_Test_Cases`
   (`ConnectSphere_Test_Cases_Sprint4.xlsx` for SCRUM-102).
2. **Commits:** `git log --oneline --grep "^SCRUM-102:"` lists one commit per
   acceptance criterion where possible.
3. **Pull request:** #133. Its description lists each AC and the test cases
   that cover it.
4. **Code:** the rule is in
   [`src/domain/essential-arrangements/policy.ts`](src/domain/essential-arrangements/policy.ts)
   (`outstandingEssentialArrangements`); the button is
   [`src/components/event-request/ConfirmEventButton.tsx`](src/components/event-request/ConfirmEventButton.tsx).
5. **Tests:** named by test case ID, e.g. `TC-102-01` in
   [`tests/unit/confirm-event.test.ts`](tests/unit/confirm-event.test.ts) and
   [`tests/integration/confirm-event.test.ts`](tests/integration/confirm-event.test.ts).

Where a story depended on another story that wasn't built yet, it used a
marked placeholder, `// DUMMY(SCRUM-<key>) D-<nn>`. Every one is listed, with
its replacement, in [`docs/dummies.md`](docs/dummies.md).

---

## Run it locally

Needs **Node 20+** and **Docker Desktop** (running).

```bash
npm install
cp .env.example .env.local      # then swap the three Supabase values for the
                                # local ones at the bottom of the file
npm run db:start                # local Supabase in Docker
npm run db:reset                # apply all migrations + seed venues
node --experimental-websocket scripts/seed-auth-users.mjs   # the test accounts above
npm run dev                     # http://localhost:3000
```

The local keys in `.env.example` are the Supabase CLI's public demo keys, the
same on every machine. More detail: [`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md).

## Tests

| Command | What it runs |
|---|---|
| `npm run test:unit` | 1,866 unit tests, no database needed |
| `npm run test:integration` | 938 integration tests against the local database |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript strict |

Run the two test commands separately, as CI does. Every pull request runs
both, plus lint, typecheck and a production build.

**Coverage:** 89.7% of lines in `src/domain` and `src/lib`, measured on
06/11/2026 with all tests passing (`npx vitest run --coverage
--no-file-parallelism`, local database running). The business rules
(`policy.ts`) are at 99.8%. It isn't 100% because most of the rest is database
plumbing in `service.ts` and the Next.js login/session code, which needs a real
signed-in browser request. Those paths were covered by each story's manual
end-to-end test on `main`. Pages and components aren't measured; they only
pass data to the domain layer.

**Why no Playwright:** the team trialled it (specs in `tests/e2e/`) and dropped
it for Release 1 on 23/10/2026. The Definition of Done doesn't require browser
tests. Every AC already had unit or integration tests in CI plus a reviewer's
manual end-to-end check on `main` with screenshots. Keeping browser tests in
step with pages that were still changing would have taken time the team needed
for the remaining stories.

---

## Architecture

One Next.js 15 app (React 19, TypeScript strict): pages and API route handlers
build and deploy together as a single container. Data and login are on
Supabase (PostgreSQL). Hosted on Vercel, with the app's server functions in
the same region as the database (Tokyo).

```
src/
├── app/          Pages and API routes (plumbing only)
├── components/   React UI, grouped by area
├── domain/       Business rules per feature: schema.ts (Zod), policy.ts
│                 (pure rules), service.ts (I/O). No framework code.
└── lib/          Supabase clients, env validation, shared API error handling
supabase/migrations/   Database schema, applied in timestamp order
tests/unit/            Rules tested without a database
tests/integration/     Routes and services tested against Postgres
```

The rules in `domain/` do no I/O, so each one can be unit-tested and traced
to an acceptance criterion. Full detail: [`docs/architecture.md`](docs/architecture.md).

---

## How the team worked

- **Scrum:** four two-week Sprints. The Product Owner and Scrum Master roles
  rotated between Sprints.
- **Evidence:** the backlog, stories and acceptance criteria are in Jira
  (exported to `1_Product_Backlog`). Test cases for each Sprint are in
  `3_Test_Cases`. Sprint planning, burndowns, retrospectives and the Change Log
  are in `4_Sprint_Evidence`.
- **Definition of Done:** agreed by the whole team; from Sprint 4 it needs
  automated tests for every AC, the full regression suite passing, a review by
  someone other than the author, and a reviewer's end-to-end test on `main`
  with screenshots. Written out in [`docs/definition-of-done.md`](docs/definition-of-done.md).
- **Reviews:** every change went through a pull request with at least one
  approval. The steps are in [`docs/pr-review-process.md`](docs/pr-review-process.md);
  the template in [`.github/pull_request_template.md`](.github/pull_request_template.md).
- **Glossary:** [`CONTEXT.md`](CONTEXT.md), one word per concept.

## Team

| GitHub | Name | Sprint 4 role |
|---|---|---|
| marcusliow | Marcus Liow | Developer, assistant reviewer |
| joshuayeo2024 | Joshua Yeo | Product Owner |
| wennnzly | Arwen Alyssa Tan | Developer |
| hdylangit | Dylan Huang | Developer |
| xjinhx | He Jinhong | Scrum Master |
| ytng05 | Ng Yee Teng | Developer |

Repository access has been granted to the instructors, Gabriel Lok
(gabriellok@smu.edu.sg) and Joseph Sung (josephsung@smu.edu.sg).
