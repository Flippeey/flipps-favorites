import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const target = process.argv[2];
const outDir = process.argv[3];

if (!target || !outDir) {
  throw new Error('Usage: node scripts/write-manifest.mjs <chrome|firefox> <outDir>');
}

const extensionVersion = process.env.EXTENSION_VERSION ?? '0.3.4';
const extensionDescription = process.env.EXTENSION_DESCRIPTION
  ?? "Flipp's Favorites replaces your new tab page with a fast, customizable bookmark dashboard featuring folder navigation, bookmark search, visual tiles, shortcuts. Use the theme controls to customize the look and feel of your new tab page and make it your own.";
const firefoxExtensionId = process.env.FIREFOX_EXTENSION_ID ?? 'com.flipps-favorites@flippflix.com';
const firefoxStrictMinVersion = process.env.FIREFOX_STRICT_MIN_VERSION ?? '140.0';
const firefoxAndroidStrictMinVersion = process.env.FIREFOX_ANDROID_STRICT_MIN_VERSION ?? '142.0';
const firefoxUpdateUrl = process.env.FIREFOX_UPDATE_URL;
const includeHttpHosts = process.env.INCLUDE_HTTP_HOSTS === '1';

// https://duckduckgo.com/* is listed explicitly because Firefox MV3 does not
// honour the https://*/* wildcard for CORS bypass on extension background fetches.
const hostPermissions = includeHttpHosts
  ? ['https://*/*', 'http://*/*', 'https://duckduckgo.com/*']
  : ['https://*/*', 'https://duckduckgo.com/*'];

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

const baseManifest = {
  manifest_version: 3,
  name: "Flipp's Favorites - Bookmarks & more",
  short_name: "Flipp's Favorites",
  version: extensionVersion,
  description: extensionDescription,
  permissions: ['bookmarks', 'storage'],
  host_permissions: hostPermissions,
  icons: extensionIcons,
  chrome_url_overrides: {
    newtab: 'newtab.html',
  },
  action: {
    default_title: "Flipp's Favorites - Bookmarks & more",
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
    browser_specific_settings: {
      gecko: {
        id: firefoxExtensionId,
        strict_min_version: firefoxStrictMinVersion,
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {
        strict_min_version: firefoxAndroidStrictMinVersion,
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
