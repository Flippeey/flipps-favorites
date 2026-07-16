import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

// Same guard as tests/global-setup.ts, scoped to just the chrome-test build:
// evidence specs run against the same test-storage build as the Chrome
// Playwright suite (dist/chrome-test), never the dist/chrome release artifact.
export default async function globalSetup(): Promise<void> {
  const chromeTestManifest = join(rootDir, 'dist', 'chrome-test', 'manifest.json');

  if (!existsSync(chromeTestManifest)) {
    throw new Error('Chrome test build not found at dist/chrome-test/. Run "npm run build:chrome:test" first.');
  }
}
