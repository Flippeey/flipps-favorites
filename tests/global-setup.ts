import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..');

export default async function globalSetup() {
  const firefoxManifest = join(rootDir, 'dist', 'firefox', 'manifest.json');
  const chromeManifest = join(rootDir, 'dist', 'chrome', 'manifest.json');

  if (!existsSync(firefoxManifest)) {
    throw new Error('Firefox build not found at dist/firefox/. Run "npm run build:firefox" first.');
  }
  if (!existsSync(chromeManifest)) {
    throw new Error('Chrome build not found at dist/chrome/. Run "npm run build:chrome" first.');
  }
}
