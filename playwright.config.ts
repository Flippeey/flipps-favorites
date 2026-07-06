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
  // Historical note: a few "persists after reload" tests used to be
  // intermittently flaky (~4 per run, rotating; each passed alone and on
  // retry). Root cause: settings/workspaces used chrome.storage.sync
  // (sync-preferred), whose writes flush asynchronously, so a reload-boot
  // re-read of sync under parallel reseed-heavy load could see stale state.
  // Fixed by tests/fixtures/launch.ts's Chrome specs loading dist/chrome-test
  // (npm run build:chrome:test), a build with __FF_TEST_STORAGE_LOCAL__ forced
  // true (vite.config.mjs), which routes the storage seam
  // (src/shared/storage-buckets.ts) onto chrome.storage.local unconditionally
  // — no async sync flush, no race. Retries stay at 1 as a general safety net
  // for residual environmental flake, not because this specific race persists.
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
