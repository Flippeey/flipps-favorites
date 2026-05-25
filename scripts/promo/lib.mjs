/**
 * Shared library for promo recording scripts.
 *
 * Selectors and message API match the React rewrite (post 2026-05):
 *   - App shell: `.ff-app`
 *   - Tiles: `.ff-tile[data-item-id][data-item-kind="bookmark"|"folder"]`
 *   - Search: `.ff-search input`, results `#ff-search-results .ff-results__item`
 *   - Settings: `getByRole('button', { name: 'Settings', exact: true })`
 *     drawer `.ff-drawer`, nav items `.ff-drawer__navitem`
 *   - Accent chips: `.ff-accentchip` (order: Blue, Teal, Green, Lime, Yellow,
 *     Orange[5], Red, Rose, Pink, Purple, Slate, Graphite)
 *   - Theme cards: `.ff-themecard--light` / `--dark`
 *   - Dock: `.ff-dock-wrap[data-mode="hover"|"always"]` + `.ff-dock__item`
 *   - Folder overlay: `.ff-folder-overlay` + `.ff-folder-overlay__crumb`
 *   - Page view: `.ff-page-view` + `.ff-crumb__here`
 *   - Sort: `.ff-sort .ff-pill` + `.ff-sort__panel` + `.ff-sort__option`
 *   - Context menu: `.ff-ctx`
 *   - Dialog: `.ff-dialog`, scrim `.ff-modal-scrim`
 *   - Onboarding: `.ff-onboard`, replay `.ff-onboarding-replay`
 *
 * Settings are updated via the message pipeline:
 *   chrome.runtime.sendMessage({ type: 'settings/patch', patch })
 */

import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = resolve(__dirname, '..', '..');
export const CHROME_EXT_PATH = join(ROOT_DIR, 'dist', 'chrome');
export const OUT_DIR = join(ROOT_DIR, 'promo');
export const VIDEO_DIR = join(OUT_DIR, 'videos');
export const SHOT_DIR = join(OUT_DIR, 'screenshots');
export const GIF_DIR = join(OUT_DIR, 'gifs');

export const VIEWPORT = { width: 1920, height: 1080 };
export const ACCENT_ORANGE = '#F57C00';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Bookmark seed data ─────────────────────────────────────────────────────
// ~100 realistic, popular sites in a nested folder structure.

export const ROOT_BOOKMARKS = [
  { title: 'Gmail',          url: 'https://mail.google.com' },
  { title: 'YouTube',        url: 'https://www.youtube.com' },
  { title: 'GitHub',         url: 'https://github.com' },
  { title: 'Reddit',         url: 'https://www.reddit.com' },
  { title: 'X',              url: 'https://x.com' },
  { title: 'Netflix',        url: 'https://www.netflix.com' },
  { title: 'Spotify',        url: 'https://open.spotify.com' },
  { title: 'Notion',         url: 'https://www.notion.so' },
  { title: 'Amazon',         url: 'https://www.amazon.com' },
  { title: 'ChatGPT',        url: 'https://chat.openai.com' },
  { title: 'Claude',         url: 'https://claude.ai' },
  { title: 'Discord',        url: 'https://discord.com' },
  { title: 'LinkedIn',       url: 'https://www.linkedin.com' },
  { title: 'Google Drive',   url: 'https://drive.google.com' },
  { title: 'Wikipedia',      url: 'https://www.wikipedia.org' },
  { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
  { title: 'Hacker News',    url: 'https://news.ycombinator.com' },
  { title: 'Slack',          url: 'https://slack.com' },
];

export const FOLDERS = [
  {
    title: '💻 Dev Tools',
    subfolders: [
      {
        title: '⚛️ Frameworks',
        bookmarks: [
          { title: 'React',    url: 'https://react.dev' },
          { title: 'Vue',      url: 'https://vuejs.org' },
          { title: 'Svelte',   url: 'https://svelte.dev' },
          { title: 'Angular',  url: 'https://angular.dev' },
          { title: 'Next.js',  url: 'https://nextjs.org' },
          { title: 'Astro',    url: 'https://astro.build' },
        ],
      },
      {
        title: '📜 Languages',
        bookmarks: [
          { title: 'TypeScript', url: 'https://www.typescriptlang.org' },
          { title: 'Python',     url: 'https://www.python.org' },
          { title: 'Rust',       url: 'https://www.rust-lang.org' },
          { title: 'Go',         url: 'https://go.dev' },
          { title: 'Kotlin',     url: 'https://kotlinlang.org' },
        ],
      },
      {
        title: '🛠️ Tools',
        bookmarks: [
          { title: 'GitHub',     url: 'https://github.com' },
          { title: 'GitLab',     url: 'https://gitlab.com' },
          { title: 'Linear',     url: 'https://linear.app' },
          { title: 'Vercel',     url: 'https://vercel.com' },
          { title: 'Cloudflare', url: 'https://www.cloudflare.com' },
          { title: 'Sentry',     url: 'https://sentry.io' },
        ],
      },
    ],
  },
  {
    title: '🎬 Media',
    subfolders: [
      {
        title: '📺 Streaming',
        bookmarks: [
          { title: 'Netflix',   url: 'https://www.netflix.com' },
          { title: 'YouTube',   url: 'https://www.youtube.com' },
          { title: 'Twitch',    url: 'https://www.twitch.tv' },
          { title: 'Disney+',   url: 'https://www.disneyplus.com' },
          { title: 'HBO Max',   url: 'https://www.max.com' },
          { title: 'Apple TV+', url: 'https://tv.apple.com' },
        ],
      },
      {
        title: '🎵 Music',
        bookmarks: [
          { title: 'Spotify',       url: 'https://open.spotify.com' },
          { title: 'SoundCloud',    url: 'https://soundcloud.com' },
          { title: 'Apple Music',   url: 'https://music.apple.com' },
          { title: 'YouTube Music', url: 'https://music.youtube.com' },
        ],
      },
      {
        title: '📖 Reading',
        bookmarks: [
          { title: 'Medium',      url: 'https://medium.com' },
          { title: 'Substack',    url: 'https://substack.com' },
          { title: 'Pocket',      url: 'https://getpocket.com' },
          { title: 'Hacker News', url: 'https://news.ycombinator.com' },
        ],
      },
    ],
  },
  {
    title: '💼 Productivity',
    subfolders: [
      {
        title: '✉️ Email',
        bookmarks: [
          { title: 'Gmail',       url: 'https://mail.google.com' },
          { title: 'Proton Mail', url: 'https://mail.proton.me' },
          { title: 'Outlook',     url: 'https://outlook.live.com' },
        ],
      },
      {
        title: '📝 Docs',
        bookmarks: [
          { title: 'Notion',       url: 'https://www.notion.so' },
          { title: 'Google Drive', url: 'https://drive.google.com' },
          { title: 'Dropbox',      url: 'https://www.dropbox.com' },
          { title: 'Confluence',   url: 'https://www.atlassian.com/software/confluence' },
        ],
      },
    ],
    bookmarks: [
      { title: 'Google Calendar', url: 'https://calendar.google.com' },
      { title: 'Cal.com',         url: 'https://cal.com' },
    ],
  },
  {
    title: '👥 Social',
    bookmarks: [
      { title: 'Reddit',    url: 'https://www.reddit.com' },
      { title: 'X',         url: 'https://x.com' },
      { title: 'LinkedIn',  url: 'https://www.linkedin.com' },
      { title: 'Discord',   url: 'https://discord.com' },
      { title: 'Bluesky',   url: 'https://bsky.app' },
      { title: 'Mastodon',  url: 'https://mastodon.social' },
      { title: 'Threads',   url: 'https://www.threads.net' },
    ],
  },
  {
    title: '📰 News',
    subfolders: [
      {
        title: '🖥️ Tech',
        bookmarks: [
          { title: 'TechCrunch',  url: 'https://techcrunch.com' },
          { title: 'The Verge',   url: 'https://www.theverge.com' },
          { title: 'Ars Technica',url: 'https://arstechnica.com' },
          { title: 'Wired',       url: 'https://www.wired.com' },
        ],
      },
      {
        title: '🌍 World',
        bookmarks: [
          { title: 'BBC News',     url: 'https://www.bbc.com/news' },
          { title: 'NPR',          url: 'https://www.npr.org' },
          { title: 'The Guardian', url: 'https://www.theguardian.com' },
          { title: 'Reuters',      url: 'https://www.reuters.com' },
        ],
      },
    ],
  },
  {
    title: '🛍️ Shopping',
    bookmarks: [
      { title: 'Amazon',     url: 'https://www.amazon.com' },
      { title: 'Etsy',       url: 'https://www.etsy.com' },
      { title: 'eBay',       url: 'https://www.ebay.com' },
      { title: 'Best Buy',   url: 'https://www.bestbuy.com' },
      { title: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter' },
      { title: 'IKEA',       url: 'https://www.ikea.com' },
    ],
  },
  {
    title: '🤖 AI',
    bookmarks: [
      { title: 'Claude',      url: 'https://claude.ai' },
      { title: 'ChatGPT',     url: 'https://chat.openai.com' },
      { title: 'Perplexity',  url: 'https://www.perplexity.ai' },
      { title: 'Gemini',      url: 'https://gemini.google.com' },
      { title: 'Midjourney',  url: 'https://www.midjourney.com' },
    ],
  },
  {
    title: '🍳 Cooking',
    bookmarks: [
      { title: 'AllRecipes',   url: 'https://www.allrecipes.com' },
      { title: 'Serious Eats', url: 'https://www.seriouseats.com' },
      { title: 'NYT Cooking',  url: 'https://cooking.nytimes.com' },
      { title: 'Bon Appétit',  url: 'https://www.bonappetit.com' },
    ],
  },
  {
    title: '✈️ Travel',
    bookmarks: [
      { title: 'Airbnb',         url: 'https://www.airbnb.com' },
      { title: 'Booking.com',    url: 'https://www.booking.com' },
      { title: 'Google Flights', url: 'https://www.google.com/travel/flights' },
      { title: 'Tripadvisor',    url: 'https://www.tripadvisor.com' },
    ],
  },
  {
    title: '📚 Reference',
    bookmarks: [
      { title: 'Wikipedia',      url: 'https://www.wikipedia.org' },
      { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { title: 'MDN Docs',       url: 'https://developer.mozilla.org' },
      { title: 'Wolfram Alpha',  url: 'https://www.wolframalpha.com' },
    ],
  },
  {
    title: '💰 Finance',
    bookmarks: [
      { title: 'Chase',     url: 'https://www.chase.com' },
      { title: 'PayPal',    url: 'https://www.paypal.com' },
      { title: 'Wise',      url: 'https://wise.com' },
      { title: 'Robinhood', url: 'https://robinhood.com' },
    ],
  },
];

// Dock items — separate folder, never appears in the grid.
export const DOCK_BOOKMARKS = [
  { title: 'Gmail',          url: 'https://mail.google.com' },
  { title: 'YouTube',        url: 'https://www.youtube.com' },
  { title: 'Google Calendar',url: 'https://calendar.google.com' },
  { title: 'Spotify',        url: 'https://open.spotify.com' },
  { title: 'Netflix',        url: 'https://www.netflix.com' },
  { title: 'Reddit',         url: 'https://www.reddit.com' },
  { title: 'Notion',         url: 'https://www.notion.so' },
  { title: 'Discord',        url: 'https://discord.com' },
];

// ─── Multi-workspace promo seed data ────────────────────────────────────────

/** Three visually distinct workspaces for the promo pipeline. */
/** Five visually distinct workspaces tailored to specific user personas for the promo pipeline. */
export const PROMO_WORKSPACES = [
  {
    name: 'Work',
    accentColor: '#3F72DC',
    themeMode: 'dark',
    backgroundMode: 'gradient',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientIntensity: 100,
    tileShape: 'squircle',
    rootBookmarks: [
      { title: 'GitHub',        url: 'https://github.com' },
      { title: 'Slack',         url: 'https://slack.com' },
      { title: 'Jira',          url: 'https://jira.atlassian.com' },
      { title: 'Vercel',        url: 'https://vercel.com' },
      { title: 'Notion',        url: 'https://www.notion.so' },
      { title: 'AWS Console',   url: 'https://console.aws.amazon.com' },
      { title: 'Linear',        url: 'https://linear.app' },
    ],
    folders: [
      {
        title: 'Project Apollo',
        bookmarks: [
          { title: 'Repository',       url: 'https://github.com' },
          { title: 'Sprint Board',     url: 'https://linear.app' },
          { title: 'CI Pipeline',      url: 'https://vercel.com' },
          { title: 'Sentry Issues',    url: 'https://sentry.io' },
        ],
      },
      {
        title: 'Documentation',
        bookmarks: [
          { title: 'MDN Web Docs',     url: 'https://developer.mozilla.org' },
          { title: 'Stack Overflow',   url: 'https://stackoverflow.com' },
          { title: 'React.dev',        url: 'https://react.dev' },
          { title: 'Tailwind CSS',     url: 'https://tailwindcss.com/docs' },
        ],
      },
    ],
  },
  {
    name: 'Personal',
    accentColor: '#23867B',
    themeMode: 'dark',
    backgroundMode: 'gradient',
    gradientStyle: 'aurora',
    gradientColorSource: 'accent',
    gradientIntensity: 100,
    tileShape: 'rounded',
    rootBookmarks: [
      { title: 'YouTube',      url: 'https://www.youtube.com' },
      { title: 'Reddit',       url: 'https://www.reddit.com' },
      { title: 'Gmail',        url: 'https://mail.google.com' },
      { title: 'Spotify',      url: 'https://open.spotify.com' },
      { title: 'Netflix',      url: 'https://www.netflix.com' },
      { title: 'WhatsApp Web', url: 'https://web.whatsapp.com' },
    ],
    folders: [
      {
        title: 'Finance',
        bookmarks: [
          { title: 'Bank Account', url: 'https://www.chase.com' },
          { title: 'YNAB',         url: 'https://app.youneedabudget.com' },
          { title: 'Vanguard',     url: 'https://investor.vanguard.com' },
        ],
      },
      {
        title: 'Travel',
        bookmarks: [
          { title: 'Google Flights', url: 'https://www.google.com/travel/flights' },
          { title: 'Airbnb',         url: 'https://www.airbnb.com' },
          { title: 'Booking.com',    url: 'https://www.booking.com' },
        ],
      },
      {
        title: 'Life Admin',
        bookmarks: [
          { title: 'Google Calendar',url: 'https://calendar.google.com' },
          { title: 'To Do',          url: 'https://todoist.com' },
          { title: 'Recipes',        url: 'https://www.seriouseats.com' },
        ],
      },
    ],
  },
  {
    name: 'AI',
    accentColor: '#8B5CF6',
    themeMode: 'dark',
    backgroundMode: 'gradient',
    gradientStyle: 'aurora',
    gradientColorSource: 'accent',
    gradientIntensity: 100,
    tileShape: 'squircle',
    rootBookmarks: [
      { title: 'ChatGPT',      url: 'https://chat.openai.com' },
      { title: 'Claude',       url: 'https://claude.ai' },
      { title: 'Perplexity',   url: 'https://www.perplexity.ai' },
      { title: 'Midjourney',   url: 'https://www.midjourney.com' },
      { title: 'Hugging Face', url: 'https://huggingface.co' },
      { title: 'Civitai',      url: 'https://civitai.com' },
    ],
    folders: [
      {
        title: 'Platforms & APIs',
        bookmarks: [
          { title: 'OpenAI Platform',   url: 'https://platform.openai.com' },
          { title: 'Anthropic Console', url: 'https://console.anthropic.com' },
          { title: 'Replicate',         url: 'https://replicate.com' },
          { title: 'Google AI Studio',  url: 'https://aistudio.google.com' },
        ],
      },
      {
        title: 'Dev Frameworks',
        bookmarks: [
          { title: 'LangChain',  url: 'https://python.langchain.com' },
          { title: 'LlamaIndex', url: 'https://docs.llamaindex.ai' },
          { title: 'Vercel AI',  url: 'https://sdk.vercel.ai/docs' },
        ],
      },
    ],
  },
  {
    name: 'Design',
    accentColor: '#F57C00',
    themeMode: 'light',
    backgroundMode: 'gradient',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientIntensity: 80,
    tileShape: 'rounded',
    rootBookmarks: [
      { title: 'Figma',     url: 'https://figma.com' },
      { title: 'Dribbble',  url: 'https://dribbble.com' },
      { title: 'Behance',   url: 'https://www.behance.net' },
      { title: 'Mobbin',    url: 'https://mobbin.com' },
      { title: 'Pinterest', url: 'https://www.pinterest.com' },
    ],
    folders: [
      {
        title: 'Typography',
        bookmarks: [
          { title: 'Google Fonts', url: 'https://fonts.google.com' },
          { title: 'Fonts In Use', url: 'https://fontsinuse.com' },
          { title: 'Fontshare',    url: 'https://www.fontshare.com' },
        ],
      },
      {
        title: 'Color & Assets',
        bookmarks: [
          { title: 'Coolors',      url: 'https://coolors.co' },
          { title: 'Unsplash',     url: 'https://unsplash.com' },
          { title: 'Iconify',      url: 'https://iconify.design' },
          { title: 'SVG Repo',     url: 'https://www.svgrepo.com' },
        ],
      },
    ],
  },
  {
    name: 'Gaming',
    accentColor: '#DC2626',
    themeMode: 'dark',
    backgroundMode: 'gradient',
    gradientStyle: 'top',
    gradientColorSource: 'accent',
    gradientIntensity: 90,
    tileShape: 'squircle',
    rootBookmarks: [
      { title: 'Steam',       url: 'https://store.steampowered.com' },
      { title: 'Twitch',      url: 'https://www.twitch.tv' },
      { title: 'Discord',     url: 'https://discord.com' },
      { title: 'r/gaming',    url: 'https://www.reddit.com/r/gaming' },
      { title: 'IGN',         url: 'https://www.ign.com' },
    ],
    folders: [
      {
        title: 'World of Warcraft',
        bookmarks: [
          { title: 'Wowhead',       url: 'https://www.wowhead.com' },
          { title: 'Raider.IO',     url: 'https://raider.io' },
          { title: 'Warcraft Logs', url: 'https://www.warcraftlogs.com' },
          { title: 'Icy Veins',     url: 'https://www.icy-veins.com/wow/' },
        ],
      },
      {
        title: 'Diablo',
        bookmarks: [
          { title: 'Maxroll',       url: 'https://maxroll.gg/d4' },
          { title: 'D4Builds',      url: 'https://d4builds.gg' },
          { title: 'Diablo Trade',  url: 'https://diablo.trade' },
        ],
      },
      {
        title: 'Dota 2',
        bookmarks: [
          { title: 'Dotabuff',            url: 'https://www.dotabuff.com' },
          { title: 'Dota 2 Pro Tracker',  url: 'https://dota2protracker.com' },
          { title: 'Liquipedia',          url: 'https://liquipedia.net/dota2' },
        ],
      },
      {
        title: 'FFXIV',
        bookmarks: [
          { title: 'The Lodestone',   url: 'https://na.finalfantasyxiv.com/lodestone/' },
          { title: 'Universalis',     url: 'https://universalis.app' },
          { title: 'Garland Tools',   url: 'https://garlandtools.org' },
          { title: 'Icy Veins FFXIV', url: 'https://www.icy-veins.com/ffxiv/' },
        ],
      },
    ],
  },
];

// ─── Launch + discovery ─────────────────────────────────────────────────────

export async function launchContext({ withVideo = false } = {}) {
  await mkdir(VIDEO_DIR, { recursive: true });
  await mkdir(SHOT_DIR, { recursive: true });
  const profileDir = await mkdtemp(join(tmpdir(), 'ff-promo-'));
  const launchOpts = {
    headless: false,
    args: [
      `--disable-extensions-except=${CHROME_EXT_PATH}`,
      `--load-extension=${CHROME_EXT_PATH}`,
      '--no-first-run',
      '--disable-default-apps',
      `--window-size=${VIEWPORT.width},${VIEWPORT.height + 40}`,
    ],
    viewport: VIEWPORT,
  };
  if (withVideo) {
    launchOpts.recordVideo = { dir: VIDEO_DIR, size: VIEWPORT };
  }
  const context = await chromium.launchPersistentContext(profileDir, launchOpts);
  return { context, profileDir };
}

export async function discoverOrigin(context) {
  const workers = context.serviceWorkers();
  const sw = workers.length > 0
    ? workers[0]
    : await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extId = new URL(sw.url()).hostname;
  return `chrome-extension://${extId}`;
}

// ─── Storage + settings ─────────────────────────────────────────────────────

function api() {
  // Runs inside the page. Chrome MV3 exposes both globals.
  return (globalThis.browser ?? globalThis.chrome);
}

/** Skip onboarding by writing the storage value directly. */
export async function skipOnboarding(page) {
  await page.evaluate(() => {
    const a = (globalThis.browser ?? globalThis.chrome);
    return a.storage.local.set({
      'onboarding-state': {
        version: 1,
        status: 'completed',
        updatedAt: Date.now(),
        completedAt: Date.now(),
        skippedAt: null,
      },
    });
  });
}

/** Force the onboarding wizard to appear on next load. */
export async function resetOnboarding(page) {
  // The defaultOnboardingState fallback is `status: 'completed'`, so removing
  // the key alone won't show the wizard — must write a pending state explicitly.
  await page.evaluate(() => {
    const a = (globalThis.browser ?? globalThis.chrome);
    return a.storage.local.set({
      'onboarding-state': {
        version: 1,
        status: 'pending',
        updatedAt: Date.now(),
        completedAt: null,
        skippedAt: null,
      },
    });
  });
}

/** Patch settings via the runtime message pipeline (matches test fixtures). */
export async function patchSettings(page, patch) {
  await page.evaluate(async (p) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    await a.runtime.sendMessage({ type: 'settings/patch', patch: p });
  }, patch);
}

/** Patch a workspace record via the runtime message pipeline. */
export async function patchWorkspace(page, id, patch) {
  await page.evaluate(async ({ id: wid, patch: p }) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    await a.runtime.sendMessage({ type: 'workspaces/patch', id: wid, patch: p });
  }, { id, patch });
}

/** Create a workspace record via the runtime message pipeline. Returns the workspace. */
export async function createWorkspace(page, workspace) {
  return page.evaluate(async (ws) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const res = await a.runtime.sendMessage({ type: 'workspaces/create', workspace: ws });
    return res.workspace;
  }, workspace);
}

/** Get all workspaces via the runtime message pipeline. */
export async function getWorkspaces(page) {
  return page.evaluate(async () => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const res = await a.runtime.sendMessage({ type: 'workspaces/get-all' });
    return res.workspaces;
  });
}

export async function clearAllBookmarks(page) {
  await page.evaluate(async () => {
    const a = (globalThis.browser ?? globalThis.chrome);
    async function emptyOf(parentId) {
      const kids = await a.bookmarks.getChildren(parentId);
      for (const k of kids) {
        await a.bookmarks.removeTree(k.id).catch(() => undefined);
      }
    }
    await emptyOf('1'); // Bookmarks bar
    await emptyOf('2'); // Other bookmarks
  });
}

// ─── Seeding ───────────────────────────────────────────────────────────────

/** Create the full ~100-bookmark tree under a new root folder. Returns IDs. */
export async function seedTree(page) {
  const ids = await page.evaluate(async ({ rootBookmarks, folders, dock }) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    async function create(parentId, title, url) {
      const node = await a.bookmarks.create({ parentId, title, ...(url ? { url } : {}) });
      return node.id;
    }
    // Parent in Other Bookmarks (id "2").
    const rootId = await create('2', "Flipp's Favorites");

    // Individual root bookmarks first so they appear above subfolders in manual order.
    for (const bm of rootBookmarks) await create(rootId, bm.title, bm.url);

    const folderIds = {};
    for (const f of folders) {
      const fid = await create(rootId, f.title);
      folderIds[f.title] = fid;
      const subIds = {};
      if (f.bookmarks) for (const bm of f.bookmarks) await create(fid, bm.title, bm.url);
      if (f.subfolders) {
        for (const sf of f.subfolders) {
          const sfid = await create(fid, sf.title);
          subIds[sf.title] = sfid;
          for (const bm of sf.bookmarks) await create(sfid, bm.title, bm.url);
        }
      }
      folderIds[f.title + ':sub'] = subIds;
    }

    const dockId = await create('2', '📌 Dock');
    for (const bm of dock) await create(dockId, bm.title, bm.url);

    return { rootId, dockId, folderIds };
  }, { rootBookmarks: ROOT_BOOKMARKS, folders: FOLDERS, dock: DOCK_BOOKMARKS });

  return ids;
}

/**
 * Seed the 3-workspace promo tree.
 * Creates bookmark folders for each workspace under "Other bookmarks" (id "2"),
 * then creates workspace records pointing to each root folder.
 * Also creates the shared dock folder.
 * Returns { workspaceIds: { Work, Personal, Creative }, dockId }.
 */
export async function seedPromoWorkspaces(page) {
  // 1. Create bookmark folders for each workspace
  const folderIds = await page.evaluate(async (workspaces) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const ids = {};
    for (const ws of workspaces) {
      const root = await a.bookmarks.create({ parentId: '2', title: ws.name });
      ids[ws.name] = root.id;
      for (const bm of ws.rootBookmarks) {
        await a.bookmarks.create({ parentId: root.id, title: bm.title, url: bm.url });
      }
      for (const folder of ws.folders) {
        const f = await a.bookmarks.create({ parentId: root.id, title: folder.title });
        for (const bm of folder.bookmarks) {
          await a.bookmarks.create({ parentId: f.id, title: bm.title, url: bm.url });
        }
      }
    }
    return ids;
  }, PROMO_WORKSPACES);

  // 2. Create dock folder
  const dockId = await page.evaluate(async (dock) => {
    const a = (globalThis.browser ?? globalThis.chrome);
    const folder = await a.bookmarks.create({ parentId: '2', title: 'Dock' });
    for (const bm of dock) {
      await a.bookmarks.create({ parentId: folder.id, title: bm.title, url: bm.url });
    }
    return folder.id;
  }, DOCK_BOOKMARKS);

  // 3. Create workspace records via message pipeline
  const workspaceIds = {};
  for (const ws of PROMO_WORKSPACES) {
    const record = {
      id: `promo-${ws.name.toLowerCase()}`,
      name: ws.name,
      rootFolderId: folderIds[ws.name],
      themeMode: ws.themeMode,
      accentColor: ws.accentColor,
      backgroundMode: ws.backgroundMode,
      solidBackgroundColor: '',
      gradientStyle: ws.gradientStyle,
      gradientColorSource: ws.gradientColorSource,
      gradientCustomColor: ws.accentColor,
      gradientIntensity: ws.gradientIntensity,
      backgroundOpacity: 70,
      backgroundFitMode: 'cover',
      backgroundPositionMode: 'center',
      layoutPreset: 'balanced',
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
      tileShape: ws.tileShape,
      showTileLabels: true,
    };
    await createWorkspace(page, record);
    workspaceIds[ws.name] = record.id;
  }

  // 4. Activate Work workspace and configure dock
  await patchSettings(page, {
    activeWorkspaceId: workspaceIds.Work,
    workspaceOrder: [workspaceIds.Work, workspaceIds.Personal, workspaceIds.Creative],
    dockFolderId: dockId,
    showDock: true,
  });

  return { workspaceIds, dockId };
}

// ─── Page helpers ───────────────────────────────────────────────────────────

export async function openNewtab(context, origin) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${origin}/newtab.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  return page;
}

export async function reloadNewtab(page, settleMs = 1800) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ff-app', { timeout: 15_000 });
  await page.waitForTimeout(settleMs); // let icons resolve
}

// ─── Motion helpers ─────────────────────────────────────────────────────────

/** Eased mouse move so demo videos feel intentional rather than teleporting. */
export async function smoothMove(page, fromX, fromY, toX, toY, durationMs = 600) {
  const steps = Math.max(8, Math.round(durationMs / 16));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await page.mouse.move(
      Math.round(fromX + (toX - fromX) * ease),
      Math.round(fromY + (toY - fromY) * ease),
    );
    await page.waitForTimeout(16);
  }
}

export async function moveToBox(page, box, durationMs = 600) {
  if (!box) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await smoothMove(page, VIEWPORT.width / 2, VIEWPORT.height / 2, cx, cy, durationMs);
}

export async function typeSlowly(locator, text, perCharDelayMs = 90) {
  await locator.pressSequentially(text, { delay: perCharDelayMs });
}

// ─── Output helpers ─────────────────────────────────────────────────────────

export async function saveVideo(page, basename) {
  await page.close();
  const src = await page.video().path();
  // Windows holds a brief lock after close.
  await sleep(1500);
  const dest = join(VIDEO_DIR, `${basename}.webm`);
  await rename(src, dest);
  console.log(`  ✓ video: videos/${basename}.webm`);
}

export async function shot(page, scenario, name) {
  const dir = join(SHOT_DIR, scenario);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ shot: screenshots/${scenario}/${name}.png`);
}

export async function cleanupProfile(profileDir) {
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
}
