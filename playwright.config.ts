import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: the real pages in a real browser (Chromium), clicked
 * through the way a user would. Kept apart from Vitest on purpose, so it can be
 * switched off without touching anything else (tests/e2e/README.md):
 * - the tests live in tests/e2e/ and are named *.spec.ts (Vitest runs *.test.ts);
 * - `npm run test:e2e` runs them; `npm test` never does;
 * - in CI they are their own `e2e` job, skipped when the repository variable
 *   E2E_ENABLED is 'false'.
 *
 * They sign in with the seeded accounts and set up their own data in the local
 * Supabase stack, using the committed .env.test (never the cloud project).
 */

// supabase-js, which tests/e2e/support/data.ts uses to set up data, needs a
// global WebSocket, and Node 20 only has one behind a flag. The test workers
// are separate Node processes that inherit this environment, so it is set here,
// before they start. Same reason as in vitest.config.ts; nothing on Node 22+.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 22 && !process.env.NODE_OPTIONS?.includes('--experimental-websocket')) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --experimental-websocket`.trim();
}

const isCI = Boolean(process.env.CI);
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  // One test at a time: every test shares the one local database.
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  // Browsers can be flaky on shared CI machines; one retry there, none locally.
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    // Kept only when a test fails: a screenshot, and a replay of every step.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Starts the app unless it is already running: locally, your `npm run dev`
  // is reused. In CI the app is built in an earlier step and started here.
  webServer: {
    command: isCI ? 'npm run start' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 180_000,
  },
});
