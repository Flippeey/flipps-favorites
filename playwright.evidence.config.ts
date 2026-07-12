import { defineConfig } from '@playwright/test';

// Separate runner for PR evidence screenshots. Deliberately its own config
// (not a project inside playwright.config.ts) so it never runs as part of
// the normal test suite and never needs contents:write-shaped CI wiring
// bolted onto the main test job. See
// docs/plan/20260711-pr-evidence-and-wiki-capture/ws1-evidence-decision.md
// for the full rationale.
export default defineConfig({
  testDir: './tests/evidence',
  testMatch: '**/*.evidence.spec.ts',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // Deterministic screenshot ordering; evidence capture is not a throughput
  // target, so one worker at a time keeps output naming/ordering stable.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup: './tests/evidence/global-setup.ts',

  projects: [
    {
      name: 'chrome',
      testMatch: '**/*.evidence.spec.ts',
    },
  ],
});
