# ConnectSphere — Project Structure

This document describes the folder convention used in `src/`, agreed by the team. New work should follow this structure rather than introducing new patterns — if a case doesn't fit cleanly, raise it with the team before improvising.

## The four layers

### `src/domain/<feature>/`
Pure business logic only — schemas, validation, error types, rules. **No framework or I/O code here**: no Supabase calls, no Next.js imports, no `fetch`. This layer should be testable with plain unit tests and no mocking of infrastructure.

Typical files inside a feature folder:
- `schema.ts` — Zod schemas and TypeScript types (the shared contract for that feature's data shapes)
- `policy.ts` — permission/business-rule functions (pure, no I/O)
- `service.ts` — orchestrates reads/writes, but delegates actual I/O to `src/lib/`

### `src/lib/`
Framework and infrastructure glue — the things that talk to the outside world. Supabase clients, environment variable validation, shared API error-handling, and any other cross-cutting infrastructure.

This is *not* organized by feature — it's organized by infrastructure concern (e.g. `src/lib/supabase/`, `src/lib/api/`, `src/lib/auth/`). Inside `src/lib/supabase/`, the query code for each table lives in its own file (e.g. `venues.ts`, `equipmentReservations.ts`).

### `src/components/<area>/`
Reusable UI building blocks — not full pages, but the pieces pages are built from (buttons, form fields, cards, badges, etc.). Grouped by area/feature where it makes sense (e.g. `src/components/venue/`), or `src/components/ui/` for things used everywhere.

### `src/app/<route>/`
Next.js App Router pages and API routes. This layer **composes** the layers above — a page or route handler should mostly be plumbing: call into `src/domain/` for logic, `src/lib/` for infrastructure, and `src/components/` for UI, rather than containing business logic itself.

## Why this split

- `domain/` being framework-free means business rules can be unit-tested in isolation, without spinning up a database or a server.
- `lib/` being separate from `domain/` means infrastructure choices (e.g. swapping Supabase clients, adding a new env var) don't require touching business logic.
- `components/` being separate from `app/` means UI pieces can be reused across multiple pages without duplication.

## Current status

| Layer | Status | What exists |
|---|---|---|
| `src/domain/` | ✅ In use | `shared/` (errors.ts, dates.ts, times.ts); `identity/`, `session/`, `navigation/`; `event-request/`, `event-information/`, `event-record/`, `event-status/`, `event-registration/`, `registration-list/`, `essential-arrangements/`, `change-request/`, `significant-change/`, `clarification/`; `review/`, `assignment/`, `safety-check/`; `venues/`, `venue-booking/`, `venue-hold/`, `availability/`, `suitability/`; `equipment/`, `equipment-request/`, `equipment-reservation/`, `equipment-out-of-service/`; `client-organisation/`, `notification/` |
| `src/lib/` | ✅ In use | `env.ts` (Zod-validated env config); `supabase/` (admin, client and server clients, `database.types.ts`, and one query file per table, e.g. `venues.ts`, `eventRegistrations.ts`); `api/handler.ts` (DomainError → HTTP status mapping); `auth/` (`currentActor.ts`, `signedInAccount.ts`) |
| `src/components/` | ✅ In use | One folder per area, e.g. `venue/`, `venue-booking/`, `event-request/`, `event-registration/`, `registration-list/`, `change-request/`, `safety-check/`, `equipment*/`, `notification/`, `navigation/`, `auth/`, plus `ui/` for shared pieces. Don't pre-scaffold empty subfolders; create one the first time a page needs it. |
| `src/app/` | ✅ In use | Pages such as `login/`, `events/`, `my-events/`, `assigned-events/`, `venues/`, `venue-booking-requests/`, `booking-queue/`, `equipment/`, `equipment-queue/`, `safety-checks/`, `register-events/`, `organisations/`, `notifications/`; API routes under `app/api/` (accounts, events, event-requests, venues, venue-bookings, equipment, safety-checks, notifications and more) |

This table is a snapshot as of Sprint 4's close (05/11/2026). Check `src/` for the current list; update this table in the same PR that adds a layer or area.

## Adding a new feature

When starting a new story that needs backend logic:

1. Create `src/domain/<feature>/` with a `schema.ts` at minimum.
2. Add `policy.ts` if the feature has permission/business rules.
3. Add `service.ts` if it needs to read/write data — it should call functions from `src/lib/supabase/`, but never import a Supabase client into `service.ts` directly or build a query (`.from()`, `.select()`, etc.) there itself. The client and the actual query-building both belong inside `src/lib/`; `service.ts` only orchestrates (validates input, calls the lib function, maps errors).
4. Add the route under `src/app/api/<resource>/route.ts`, using `handleApiError()` from `src/lib/api/handler.ts` for consistent error responses.
5. Add unit tests under `tests/unit/`, matching official test case IDs where they exist (see `ConnectSphere_Test_Cases_v3.xlsx`). Integration tests go in `tests/integration/` and Playwright specs in `tests/e2e/`. From Sprint 4, automated tests covering every AC are part of the Definition of Done.

For UI work, create `src/components/<area>/` the first time a page needs a reusable piece — don't create it speculatively ahead of need.
