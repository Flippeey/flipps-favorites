import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/specs',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/global-setup.ts',

  projects: [
    {
      name: 'firefox',
      testMatch: '**/*.spec.ts',
    },
    {
      name: 'chrome',
      testMatch: '**/*.spec.ts',
    },
  ],
});
