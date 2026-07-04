import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/specs',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // Files run in parallel across workers (each worker gets its own isolated
  // Chrome + profile via the world fixture); tests within a file stay serial.
  // Spreading the ~16 spec files over several workers keeps any one browser
  // from doing ~95 sequential reseeds, which degrades a long-lived context.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // A few "persists after reload" tests are intermittently flaky (~4 per run,
  // rotating; each passes alone and on retry). Root cause: settings/workspaces
  // use chrome.storage.sync (sync-preferred), whose writes flush asynchronously.
  // The app re-reads sync on reload-boot, so under parallel reseed-heavy load a
  // mutate->reload can read stale state. Gating reloads on the persisted value
  // is not viable — sync read-back itself lags past any sane timeout here. One
  // retry absorbs it; Playwright reports the flaky count so it stays visible.
  // A true fix would force chrome.storage.local under test (build flag).
  retries: 1,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI
    ? [
        ['github'],
        ['@estruyf/github-actions-reporter', { title: 'Playwright results', useDetails: true, showError: true }],
        ['html', { open: 'never' }],
      ]
    : 'list',
  globalSetup: './tests/global-setup.ts',

  projects: [
    {
      name: 'firefox',
      testMatch: '**/icons.spec.ts',
    },
    {
      name: 'chrome',
      testMatch: '**/*.spec.ts',
    },
  ],
});
