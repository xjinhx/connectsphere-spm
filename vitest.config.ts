import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';

/**
 * @supabase/supabase-js builds a realtime client on construction, which needs a
 * global WebSocket. Node only exposes one by default from v22; on v20 it sits
 * behind --experimental-websocket. Vitest runs each test file in a worker and
 * filters the parent process's flags, so the flag has to be handed to the
 * workers here rather than on the command line.
 *
 * Empty (and therefore inert) on Node 22+. Only integration tests construct a
 * Supabase client; unit tests are unaffected either way.
 */
const nodeMajor = Number(process.versions.node.split('.')[0]);
const websocketArgv = nodeMajor < 22 ? ['--experimental-websocket'] : [];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    poolOptions: {
      forks: { execArgv: websocketArgv },
      threads: { execArgv: websocketArgv },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/domain/**', 'src/lib/**'],
      exclude: ['**/*.d.ts', 'src/lib/supabase/database.types.ts'],
      thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
    },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
