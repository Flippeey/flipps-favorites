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
  // A handful of interaction/reload tests are timing-flaky under parallel CPU
  // contention (optimistic UI + the 130ms workspace-switch delay); one retry
  // absorbs them. Playwright still reports the flaky count, so flake stays
  // visible rather than hidden. Root-cause sweep is Phase 4.3.
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? 'github' : 'list',
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
