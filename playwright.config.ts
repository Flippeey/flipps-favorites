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
  // Storage test flag: Chrome specs load dist/chrome-test (npm run build:chrome:test),
  // built with __FF_TEST_STORAGE_LOCAL__ = true (vite.config.mjs), routing all storage
  // writes to chrome.storage.local instead of sync-preferred. Eliminates the persists-after-reload
  // race from async sync flush under parallel reseed load. Retries: 0.
  retries: 0,
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
