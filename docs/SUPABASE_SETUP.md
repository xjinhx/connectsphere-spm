# Supabase Setup

Answers the two questions that come up first: *where do my keys go?* and *do we
need the `supabase/` folder if we build the schema in the dashboard?*

---

## 1. Where do keys and secrets go?

**Exactly one file: `.env.local`.** It is gitignored. Nothing else needs editing.

```bash
cp .env.example .env.local   # then fill in the values
```

| Variable | Where to get it | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dashboard → Project Settings → **API** → Project URL | No |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard → Project Settings → **API** → `anon` `public` | No |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Project Settings → **API** → `service_role` | **YES** |
| `DATABASE_URL` | Dashboard → Project Settings → **Database** → Connection string | **YES** |

### How the value reaches the code

```
.env.local
   └─> src/lib/env.ts                 validates on boot, fails loudly if malformed
         ├─> src/lib/supabase/server.ts   server: session client + admin client
         └─> src/lib/supabase/client.ts   browser: auth only
```

**You never edit those three files.** Centralising it is the point: one place to
look, one place to change, and a typo gives a clear error at startup instead of
`supabaseUrl is required` from somewhere deep in a request.

### Two rules that matter

1. **`service_role` must never get a `NEXT_PUBLIC_` prefix.** Anything prefixed
   `NEXT_PUBLIC_` is inlined into the browser bundle. The service key bypasses
   all row-level security — in the browser that is a full database takeover.
2. **CI and hosting do not read `.env.local`.** GitHub Actions reads repository
   secrets; Vercel reads project environment variables. Never commit a secret to
   make a pipeline pass.

---

## 2. Do we need `supabase/` if we build the schema in the dashboard?

**Yes — you need `supabase/migrations/` committed to git.** This is independent
of whether you write SQL by hand or click tables together in Supabase Studio.

> The folder does not exist in the repo yet. Create it as soon as you have any
> schema — see the UI-first workflow below, which generates it for you.

The question that matters is not *SQL file vs. dashboard*, it is **does the
schema exist anywhere other than our one cloud project?** If it does not:

- **Deliverable #7 breaks.** Instructors clone the repo and run it. With no
  migrations there is no schema, and the app does not start.
- **CI cannot test against a database.** There is nothing to create one from.
- **Four developers share one mutable database** with no history. Someone drops
  a column on Tuesday and nobody can explain why Thursday broke.
- **The "Code quality and CI" rubric row** rewards schema changes that are
  reviewable in a pull request.

### Both workflows are fine — pick either, or mix them

**UI-first** — click it together in Studio, then *capture* it:

```bash
# make your changes in the Supabase dashboard, then:
supabase db pull        # writes a migration file capturing what changed
git add supabase/migrations && git commit
```

**SQL-first** — write the migration, then push it up:

```bash
supabase migration new create_venue_tables   # creates a timestamped .sql file
# edit supabase/migrations/<timestamp>_create_venue_tables.sql
supabase db push                             # apply to the linked project
```

UI-first is perfectly legitimate — most teams find it faster for a first draft.
The only non-negotiable step is running `db pull` afterwards so the change lands
in git.

### What each file in `supabase/` is for

| Path | Needed? | Why |
|---|---|---|
| `migrations/*.sql` | **Yes, once you have schema** | The schema itself. Without these a fresh clone has no database. |
| `config.toml` | For local dev + CI | Configures the local Docker stack (ports, auth settings). |
| `seed.sql` | For local dev + demos | Demo rows. Runs on `db reset`. Gives you working data instantly. |
| `.temp/` | No — gitignored | Local CLI state from `supabase link`. |

---

## 3. Connecting to your cloud project

This project is already linked (`supabase/.temp/linked-project.json`). For a
teammate setting up fresh:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
```

Then copy the four values from the dashboard into `.env.local`.

Once migrations exist:

```bash
npx supabase db push     # applies committed migrations to the linked project
```

⚠️ `db push` applies migrations that are not yet in the cloud project. If
someone has already hand-built tables there with the same names, run
`supabase db pull` **first** to capture what exists, or the push will conflict.

---

## 4. Optional: local stack

Requires Docker Desktop. Worth setting up before the final sprint — it is what
makes CI able to test against a real database.

```bash
npm run db:start        # Postgres + Auth + Studio in Docker
npm run db:reset        # applies migrations + seed
```

`npm run db:start` prints local URLs and keys. The defaults already in
`.env.example` point at the local stack and use the Supabase CLI's well-known
demo keys — identical on every machine, and not secrets.

---

## 5. Regenerating database types

After any schema change:

```bash
npm run db:types    # writes src/lib/supabase/database.types.ts
```

Then swap the `any` in the `AdminClient` type in
[`src/lib/supabase/server.ts`](../src/lib/supabase/server.ts) for the generated
`Database` type. That single edit upgrades every query in the codebase to
compiler-checked column names.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY is required` at boot | `.env.local` missing or incomplete | `cp .env.example .env.local` and fill it in |
| Queries return zero rows | Row-level security denying access | Query from the server through the admin client, or write an RLS policy |
| `supabase start` fails | Docker not running | Start Docker Desktop |
| `npm install` leaves missing modules | OneDrive corrupting `node_modules` | See the OneDrive section in the [README](../README.md) |
