import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

export default async function globalSetup() {
  const firefoxManifest = join(rootDir, 'dist', 'firefox', 'manifest.json');

  if (!existsSync(firefoxManifest)) {
    throw new Error('Firefox build not found at dist/firefox/. Run "npm run build:firefox" first.');
  }
}
