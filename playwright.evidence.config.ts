import { defineConfig } from '@playwright/test';

// Separate runner for PR evidence screenshots. Deliberately its own config
// (not a project inside playwright.config.ts) so it never runs as part of
// the normal test suite and never needs contents:write-shaped CI wiring
// bolted onto the main test job. See
// docs/plan/20260711-pr-evidence-and-wiki-capture/ws1-evidence-decision.md
// for the full rationale.
//
// testDir is `tests/evidence/pr` — the gitignored drop-zone for the current PR's
// throwaway spec — NOT `tests/evidence`. Two reasons: per-PR specs are never
// committed to this repo (they live on the disposable pr-evidence branch and CI
// copies them in here), and scoping the run to that one directory keeps a PR's
// evidence comment to that PR's own screenshots. When the runner walked all of
// tests/evidence, every PR re-ran and re-posted every committed spec's captures —
// PR #64's evidence led with unrelated example-edit-dialog shots.
// `example-edit-dialog.evidence.spec.ts` therefore sits outside this testDir: it
// is a typechecked reference to copy, not something that runs.
export default defineConfig({
  testDir: './tests/evidence/pr',
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
