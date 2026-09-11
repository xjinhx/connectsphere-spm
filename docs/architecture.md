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

This is *not* organized by feature — it's organized by infrastructure concern (e.g. `src/lib/supabase/`, `src/lib/api/`).

### `src/components/<area>/`
Reusable UI building blocks — not full pages, but the pieces pages are built from (buttons, form fields, cards, badges, etc.). Grouped by area/feature where it makes sense (e.g. `src/components/venue/`), or `src/components/shared/` for things used everywhere.

### `src/app/<route>/`
Next.js App Router pages and API routes. This layer **composes** the layers above — a page or route handler should mostly be plumbing: call into `src/domain/` for logic, `src/lib/` for infrastructure, and `src/components/` for UI, rather than containing business logic itself.

## Why this split

- `domain/` being framework-free means business rules can be unit-tested in isolation, without spinning up a database or a server.
- `lib/` being separate from `domain/` means infrastructure choices (e.g. swapping Supabase clients, adding a new env var) don't require touching business logic.
- `components/` being separate from `app/` means UI pieces can be reused across multiple pages without duplication.

## Current status

| Layer | Status | What exists |
|---|---|---|
| `src/domain/` | ✅ In use | `domain/shared/errors.ts` (DomainError classes); `domain/identity/` (roles.ts, policy.ts, service.ts — SCRUM-206) |
| `src/lib/` | ✅ In use | `lib/env.ts` (Zod-validated env config); `lib/supabase/client.ts` + `server.ts`; `lib/api/handler.ts` (DomainError → HTTP status mapping) |
| `src/components/` | ⏳ Not yet created | No UI components built yet — will be created by whoever first needs a reusable UI piece. Don't pre-scaffold empty subfolders; let structure emerge from real usage. |
| `src/app/` | ✅ In use | `app/page.tsx`, `app/layout.tsx`; `app/api/accounts/[id]/roles/route.ts` (SCRUM-206) |

## Adding a new feature

When starting a new story that needs backend logic:

1. Create `src/domain/<feature>/` with a `schema.ts` at minimum.
2. Add `policy.ts` if the feature has permission/business rules.
3. Add `service.ts` if it needs to read/write data (import Supabase clients from `src/lib/supabase/`, never call Supabase directly from `domain/`).
4. Add the route under `src/app/api/<resource>/route.ts`, using `handleApiError()` from `src/lib/api/handler.ts` for consistent error responses.
5. Add unit tests under `tests/unit/`, matching official test case IDs where they exist (see `ConnectSphere_Test_Cases_v3.xlsx`).

For UI work, create `src/components/<area>/` the first time a page needs a reusable piece — don't create it speculatively ahead of need.
