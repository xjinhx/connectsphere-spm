# Supabase Setup

Answers the two questions every teammate asks: *do we need the `supabase/` folder?* and *where do my keys go?*

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
| `SENDGRID_API_KEY` | SendGrid → Settings → API Keys | **YES** |
| `CRON_SECRET` | Invent one (`openssl rand -hex 32`) | **YES** |

### How the value reaches the code

```
.env.local
   └─> src/lib/env.ts          validates on boot, fails loudly if malformed
         └─> src/lib/supabase/server.ts    (server: session + admin clients)
         └─> src/lib/supabase/client.ts    (browser: auth only)
```

**You never edit those three files.** Centralising it is the point: one place to
look, one place to change, and a typo produces a clear error at startup instead
of `supabaseUrl is required` three layers deep.

### Two rules that matter

1. **`service_role` must never get a `NEXT_PUBLIC_` prefix.** Anything prefixed
   `NEXT_PUBLIC_` is inlined into the browser bundle. The service key bypasses
   all row-level security — in the browser it is a full database takeover.
2. **CI and hosting do not use `.env.local`.** GitHub Actions reads repository
   secrets; Vercel reads project environment variables. Never commit a secret to
   make a pipeline pass.

---

## 2. Do we still need the `supabase/` folder?

**Yes — keep `supabase/migrations/`.** This is independent of whether you write
SQL by hand or click tables together in the Supabase Studio UI.

The question that matters is not *SQL file vs. dashboard*, it is **does the
schema exist anywhere other than our one cloud project?** If it does not:

- **Deliverable #7 breaks.** The instructors clone the repo and run it. With no
  migrations there is no schema, and the app does not start.
- **CI cannot run integration tests.** There is no database to create.
- **Four developers share one mutable database** with no history. Someone drops
  a column on Tuesday and nobody can explain why Thursday broke.
- **The "Code quality and CI" rubric row** rewards schema changes that are
  reviewable in a pull request.

### Both workflows are fine — pick either, or mix them

**SQL-first** — write the migration, then push it up:

```bash
supabase migration new add_waitlist_column   # creates a timestamped .sql file
# edit supabase/migrations/<timestamp>_add_waitlist_column.sql
supabase db reset                            # test locally from scratch
supabase db push                             # apply to the linked cloud project
```

**UI-first** — click it together in Studio, then *capture* it:

```bash
# make your changes in the Supabase dashboard, then:
supabase db pull        # writes a migration file capturing what you changed
git add supabase/migrations && git commit
```

UI-first is perfectly legitimate. The only non-negotiable step is running
`db pull` afterwards so the change lands in git.

### What each file in `supabase/` is for

| Path | Needed? | Why |
|---|---|---|
| `migrations/*.sql` | **Always** | The schema itself. Without these a fresh clone has no database. |
| `config.toml` | For local dev + CI | Configures the local Docker stack (ports, auth settings). |
| `seed.sql` | For local dev + demos | Demo users, venues, equipment. Runs on `db reset`. Gives you working logins instantly. |

If you decide never to run locally you *could* drop `config.toml` and `seed.sql`
— but you would lose reliable CI and the one-command demo reset, which is a bad
trade for two files.

---

## 3. First-time setup

### Option A — Local stack (recommended for development)

Requires Docker Desktop.

```bash
npm install
npm run db:start        # starts Postgres, Auth, Studio in Docker
npm run db:reset        # applies migrations + seed data
cp .env.example .env.local   # the defaults already point at the local stack
npm run dev
```

`npm run db:start` prints your local URL and keys. The defaults already in
`.env.example` are the Supabase CLI's well-known demo keys — identical on every
machine, and not secrets.

Sign in with any seeded account (password `Password123!`):

| Role | Email |
|---|---|
| Event Organiser | `organiser@acme.example.com` |
| Event Coordinator | `coordinator@connectsphere.example.com` |
| Venue Staff | `venue@connectsphere.example.com` |
| Technical Support | `tech@connectsphere.example.com` |
| Attendee | `attendee@example.com` |

> `tech@connectsphere.example.com` holds **two** roles (Technical Support *and*
> Attendee) so the Q#56 multi-role case is exercised in every demo.

### Option B — Shared cloud project

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies our migrations to the cloud project
```

Then put the cloud values into `.env.local`.

⚠️ **`db push` applies migrations that do not exist there yet.** If someone has
already hand-built tables in that project with the same names, resolve the
conflict before pushing — the safest route is `supabase db pull` first to
capture what is already there.

---

## 4. Scheduled jobs

Two mechanisms, deliberately:

**Pure SQL** (`fn_auto_complete_events`, `fn_release_cancelled_event_resources`)
run as database functions, scheduled by `pg_cron` in migration `0800`. Nothing to
keep awake, and testable with a direct SQL call.

**App logic** (email retries, reminder composition) runs as `/api/jobs/*` route
handlers guarded by `CRON_SECRET`, so it shares the same services and tests as
the interactive paths. Register them on the hosted project:

```sql
select cron.schedule('dispatch-emails', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://<your-app-domain>/api/jobs/dispatch-emails',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
  );
$$);
```

`pg_cron` is not available on the free tier of every region. If yours lacks it,
GitHub Actions on a `schedule:` trigger calling the same endpoints works fine —
the endpoints do not care what invoked them.

---

## 5. Regenerating database types

After any schema change:

```bash
npm run db:types    # writes src/lib/supabase/database.types.ts
```

Optional but worth doing before the final sprint: it turns the repository layer
from hand-written row types into compiler-checked ones.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY is required` at boot | `.env.local` missing or incomplete | `cp .env.example .env.local` and fill it in |
| Every query returns zero rows | RLS is denying direct access — by design | Data access must go through `/api/*`, never `supabase.from()` in a component |
| `supabase start` fails | Docker not running | Start Docker Desktop |
| Login fails on a fresh cloud project | No seeded users there | `supabase db push`, then create users in Dashboard → Authentication |
| Migration fails on `pg_cron` | Extension unavailable in your region | Migration `0800` already guards this and logs a notice; use GitHub Actions scheduling instead |
