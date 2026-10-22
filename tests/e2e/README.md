# End-to-end tests (Playwright)

The real pages in a real browser, clicked through the way a user would. They
sit alongside the unit and integration tests (Vitest) and run on every push and
pull request as their own CI job.

## Run them locally

1. Docker Desktop and Supabase running (`npm run db:start`), test accounts
   seeded (`npm run seed:users`).
2. Once per computer: `npx playwright install chromium`.
3. `npm run test:e2e`. It reuses your `npm run dev` if it's running, or
   starts one.

Useful extras:

- `npm run test:e2e -- --ui` steps through each test with a snapshot of the page at every step.
- `npm run test:e2e -- --headed` opens the browser so you can watch.
- `npx playwright show-report` opens the last run's report, with screenshots of any failure.

## Write one

- One file per story, named after it: `tests/e2e/scrum-<key>-<what>.spec.ts`.
  Use `.spec.ts`, never `.test.ts`: Vitest runs `*.test.ts` files.
- Name each test by its ID, e.g. `E2E-229: ...` or `SCRUM-232 AC1: ...`.
- Sign in with `signIn(page, 'coordinator')` from `support/accounts.ts`. Call it
  again to switch roles mid-test.
- Set up the starting data in `test.beforeAll` with `support/data.ts`, using
  `RUN` in names so runs never clash. Delete it in `test.afterAll`.
- Do the steps on the pages, finding things the way a user does:
  `getByRole`, `getByLabel`, `getByText`. Assert with `expect(...)`, which waits
  on its own; never add fixed waits.
- Test your own story's pages only, the same rule as for code.

`scrum-229-replacement.spec.ts` is the full pattern: data set-up, two roles,
every AC. `scrum-232-lead-landing.spec.ts` is the smallest.

## In CI, and switching it off

The `e2e` job in `.github/workflows/ci.yml` starts Supabase, seeds the
accounts, builds the app and runs these tests. If anything fails, the report is
uploaded as the `playwright-report` artifact.

- **Trial mode:** the job is `continue-on-error`, so a failure shows but never
  blocks a merge. Remove that line once the team wants it required.
- **Pause it:** set the repository variable `E2E_ENABLED` to `false`
  (Settings > Secrets and variables > Actions > Variables). The job is skipped,
  with no code change.
- **Remove it:** delete the `e2e` job from `ci.yml`. To remove Playwright
  entirely, also delete `tests/e2e/`, `playwright.config.ts`, the `test:e2e`
  script and the `@playwright/test` dev dependency. Nothing else uses them.
