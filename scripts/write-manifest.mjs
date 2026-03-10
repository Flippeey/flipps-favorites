import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const target = process.argv[2];
const outDir = process.argv[3];

if (!target || !outDir) {
  throw new Error('Usage: node scripts/write-manifest.mjs <chrome|firefox> <outDir>');
}

const baseManifest = {
  manifest_version: 3,
  name: "Flipp's Favorites - Bookmarks & more",
  short_name: "Flipp's Favorites",
  version: '0.1.0',
  description: 'A clean-room bookmark dashboard for new tabs.',
  permissions: ['bookmarks', 'storage'],
  host_permissions: ['https://*/*', 'http://*/*'],
  chrome_url_overrides: {
    newtab: 'newtab.html',
  },
  action: {
    default_title: "Flipp's Favorites - Bookmarks & more",
  },
};

const browserSpecific = {
  chrome: {
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
  },
  firefox: {
    background: {
      scripts: ['background.js'],
      type: 'module',
    },
    browser_specific_settings: {
      gecko: {
        id: 'flipps-favorites-bookmarks-more@personal',
        strict_min_version: '128.0',
      },
    },
  },
};

if (!(target in browserSpecific)) {
  throw new Error(`Unsupported target: ${target}`);
}

const manifest = {
  ...baseManifest,
  ...browserSpecific[target],
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
