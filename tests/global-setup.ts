import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..');

export default async function globalSetup() {
  const firefoxManifest = join(rootDir, 'dist', 'firefox', 'manifest.json');
  // Chrome specs load dist/chrome-test (tests/fixtures/launch.ts), a build with
  // __FF_TEST_STORAGE_LOCAL__ forced true — see storage-buckets.ts.
  const chromeTestManifest = join(rootDir, 'dist', 'chrome-test', 'manifest.json');

  if (!existsSync(firefoxManifest)) {
    throw new Error('Firefox build not found at dist/firefox/. Run "npm run build:firefox" first.');
  }
  if (!existsSync(chromeTestManifest)) {
    throw new Error('Chrome test build not found at dist/chrome-test/. Run "npm run build:chrome:test" first.');
  }
}
