import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const target = process.argv[2];
const outDir = process.argv[3];

if (!target || !outDir) {
  throw new Error('Usage: node scripts/write-manifest.mjs <chrome|firefox> <outDir>');
}

const extensionVersion = process.env.EXTENSION_VERSION ?? '2.6.1';
const firefoxExtensionId = process.env.FIREFOX_EXTENSION_ID ?? 'com.flipps-favorites@flippflix.com';
const firefoxStrictMinVersion = process.env.FIREFOX_STRICT_MIN_VERSION ?? '140.0';
const firefoxUpdateUrl = process.env.FIREFOX_UPDATE_URL;
const includeHttpHosts = process.env.INCLUDE_HTTP_HOSTS === '1';

// Chrome uses declarativeNetRequest for CORS bypass and requires explicit host entries
// for each favicon service. Firefox uses XMLHttpRequest via host_permissions on a
// background page, where the https://*/* wildcard IS honoured for cross-origin XHR —
// so duckduckgo.com and icon.horse are already covered by it and don't need explicit listing.
const chromeHostPermissions = includeHttpHosts
  ? ['https://*/*', 'http://*/*', 'https://duckduckgo.com/*', 'https://icon.horse/*']
  : ['https://*/*', 'https://duckduckgo.com/*', 'https://icon.horse/*'];

const firefoxHostPermissions = includeHttpHosts
  ? ['https://*/*', 'http://*/*']
  : ['https://*/*'];

const homepageUrl = process.env.EXTENSION_HOMEPAGE_URL;
const extensionIcons = {
  16: 'icons/ff-icon-16.png',
  32: 'icons/ff-icon-32.png',
  48: 'icons/ff-icon-48.png',
  96: 'icons/ff-icon-96.png',
  128: 'icons/ff-icon-128.png',
  256: 'icons/ff-icon-256.png',
};

const actionIcons = {
  16: 'icons/ff-icon-16.png',
  24: 'icons/ff-icon-24.png',
  32: 'icons/ff-icon-32.png',
};

const hostPermissions = target === 'firefox' ? firefoxHostPermissions : chromeHostPermissions;

const baseManifest = {
  manifest_version: 3,
  name: '__MSG_extensionName__',
  short_name: '__MSG_extensionShortName__',
  default_locale: 'en',
  version: extensionVersion,
  description: '__MSG_extensionDescription__',
  permissions: ['bookmarks', 'storage', 'declarativeNetRequest'],
  host_permissions: hostPermissions,
  icons: extensionIcons,
  chrome_url_overrides: {
    newtab: 'newtab.html',
  },
  action: {
    default_title: '__MSG_actionTitle__',
    default_icon: actionIcons,
  },
};

if (homepageUrl) {
  baseManifest.homepage_url = homepageUrl;
}

const browserSpecific = {
  chrome: {
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
  },
  firefox: {
    background: {
      // Use a background page (not a service worker) so that XMLHttpRequest is
      // available for host_permissions CORS bypass. Firefox 140 runs background.scripts
      // as a service worker where fetch() does not get the CORS bypass.
      page: 'background.html',
    },
    // Firefox shows the Home page (about:home) on startup, not the new tab page,
    // so chrome_url_overrides.newtab alone never appears on browser launch.
    // Chrome/Edge open the NTP on startup and don't need (or reliably support) this.
    chrome_settings_overrides: {
      homepage: 'newtab.html',
    },
    browser_specific_settings: {
      gecko: {
        id: firefoxExtensionId,
        strict_min_version: firefoxStrictMinVersion,
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
};

if (firefoxUpdateUrl) {
  browserSpecific.firefox.browser_specific_settings.gecko.update_url = firefoxUpdateUrl;
}

if (!(target in browserSpecific)) {
  throw new Error(`Unsupported target: ${target}`);
}

const manifest = {
  ...baseManifest,
  ...browserSpecific[target],
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
