// Typed seed data — single source of truth for the bookmark/workspace worlds
// used by both the promo recording scripts (scripts/promo/*.mjs) and the
// Playwright test suite (tests/**). Node ≥22.18 strips these types on import,
// so plain `.mjs` scripts can consume this `.ts` module directly.

import type {
  ThemeMode,
  BackgroundMode,
  GradientStyle,
  BackgroundColorSource,
  TileShape,
} from './models';

export interface BookmarkSeed {
  title: string;
  url: string;
}

/** A flat folder: a title plus a list of bookmarks (no nesting). */
export interface SubFolderSeed {
  title: string;
  bookmarks: BookmarkSeed[];
}

/** A promo persona workspace: visual identity plus its bookmark world. */
export interface PromoWorkspaceSeed {
  name: string;
  accentColor: string;
  themeMode: ThemeMode;
  backgroundMode: BackgroundMode;
  gradientStyle: GradientStyle;
  gradientColorSource: BackgroundColorSource;
  gradientIntensity: number;
  tileShape: TileShape;
  rootBookmarks: BookmarkSeed[];
  folders: SubFolderSeed[];
}


// Dock items — separate folder, never appears in the grid.
export const DOCK_BOOKMARKS: BookmarkSeed[] = [
  { title: 'Gmail', url: 'https://mail.google.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' },
  { title: 'Google Calendar', url: 'https://calendar.google.com' },
  { title: 'Spotify', url: 'https://open.spotify.com' },
  { title: 'Netflix', url: 'https://www.netflix.com' },
  { title: 'Reddit', url: 'https://www.reddit.com' },
  { title: 'Notion', url: 'https://www.notion.so' },
  { title: 'Discord', url: 'https://discord.com' },
];

// ─── Five-persona multi-workspace world ─────────────────────────────────────

export const PROMO_WORKSPACES: PromoWorkspaceSeed[] = [
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
      { title: 'GitHub', url: 'https://github.com' },
      { title: 'Slack', url: 'https://slack.com' },
      { title: 'Zoom', url: 'https://zoom.us' },
      { title: 'Jira', url: 'https://jira.atlassian.com' },
      { title: 'Vercel', url: 'https://vercel.com' },
      { title: 'AWS Console', url: 'https://console.aws.amazon.com' },
      { title: 'Linear', url: 'https://linear.app' },
      { title: 'OneDrive', url: 'https://onedrive.live.com' },
      { title: 'Google Analytics', url: 'https://analytics.google.com' },
      { title: 'Cloudflare', url: 'https://www.cloudflare.com' },
    ],
    folders: [
      {
        title: 'Project Apollo',
        bookmarks: [
          { title: 'Repository', url: 'https://github.com' },
          { title: 'Sprint Board', url: 'https://linear.app' },
          { title: 'CI Pipeline', url: 'https://vercel.com' },
          { title: 'Sentry Issues', url: 'https://sentry.io' },
        ],
      },
      {
        title: 'Documentation',
        bookmarks: [
          { title: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
          { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
          { title: 'React.dev', url: 'https://react.dev' },
          { title: 'Tailwind CSS', url: 'https://tailwindcss.com/docs' },
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
      { title: 'YouTube', url: 'https://www.youtube.com' },
      { title: 'Reddit', url: 'https://www.reddit.com' },
      { title: 'Google Calendar', url: 'https://calendar.google.com' },
      { title: 'Gmail', url: 'https://mail.google.com' },
      { title: 'Spotify', url: 'https://open.spotify.com' },
      { title: 'Netflix', url: 'https://www.netflix.com' },
      { title: 'WhatsApp Web', url: 'https://web.whatsapp.com' },
    ],
    folders: [
      {
        title: 'Finance',
        bookmarks: [
          { title: 'Bank Account', url: 'https://www.chase.com' },
          { title: 'YNAB', url: 'https://app.youneedabudget.com' },
          { title: 'Trade Republic', url: 'https://traderepublic.com' },
        ],
      },
      {
        title: 'Travel',
        bookmarks: [
          { title: 'Google Flights', url: 'https://www.google.com/travel/flights' },
          { title: 'Airbnb', url: 'https://www.airbnb.com' },
          { title: 'Booking.com', url: 'https://www.booking.com' },
          { title: 'Tripadvisor', url: 'https://www.tripadvisor.com' },
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
      { title: 'ChatGPT', url: 'https://chat.openai.com' },
      { title: 'Claude', url: 'https://claude.ai' },
      { title: 'Gemini', url: 'https://gemini.google.com' },
      { title: 'Mistral', url: 'https://mistral.ai' },
      { title: 'Perplexity', url: 'https://www.perplexity.ai' },
      { title: 'Midjourney', url: 'https://www.midjourney.com' },
      { title: 'Deepseek', url: 'https://chat.deepseek.com' },
      { title: 'Reddit r/AI', url: 'https://www.reddit.com/r/ArtificialIntelligence/' },
    ],
    folders: [
      {
        title: 'Platforms & APIs',
        bookmarks: [
          { title: 'OpenAI Platform', url: 'https://platform.openai.com' },
          { title: 'Anthropic Console', url: 'https://console.anthropic.com' },
          { title: 'Replicate', url: 'https://replicate.com' },
          { title: 'Google AI Studio', url: 'https://aistudio.google.com' },
        ],
      },
      {
        title: 'Dev Frameworks',
        bookmarks: [
          { title: 'LangChain', url: 'https://python.langchain.com' },
          { title: 'LlamaIndex', url: 'https://docs.llamaindex.ai' },
          { title: 'Vercel AI', url: 'https://sdk.vercel.ai/docs' },
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
      { title: 'Figma', url: 'https://figma.com' },
      { title: 'Adobe Creative Cloud', url: 'https://www.adobe.com/creativecloud.html' },
      { title: 'SVG Edit', url: 'https://www.svgedit.net' },
      { title: 'Claude Design', url: 'https://claude.ai/design' },
      { title: 'Behance', url: 'https://www.behance.net' },
      { title: 'Mobbin', url: 'https://mobbin.com' },
      { title: 'Pinterest', url: 'https://www.pinterest.com' },
    ],
    folders: [
      {
        title: 'Typography',
        bookmarks: [
          { title: 'Google Fonts', url: 'https://fonts.google.com' },
          { title: 'Fonts In Use', url: 'https://fontsinuse.com' },
          { title: 'Fontshare', url: 'https://www.fontshare.com' },
        ],
      },
      {
        title: 'Color & Assets',
        bookmarks: [
          { title: 'Coolors', url: 'https://coolors.co' },
          { title: 'Unsplash', url: 'https://unsplash.com' },
          { title: 'Iconify', url: 'https://iconify.design' },
          { title: 'SVG Repo', url: 'https://www.svgrepo.com' },
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
      { title: 'Steam', url: 'https://store.steampowered.com' },
      { title: 'Twitch', url: 'https://www.twitch.tv' },
      { title: 'Discord', url: 'https://discord.com' },
      { title: 'r/gaming', url: 'https://www.reddit.com/r/gaming' },
      { title: 'IGN', url: 'https://www.ign.com' },
    ],
    folders: [
      {
        title: 'World of Warcraft',
        bookmarks: [
          { title: 'Wowhead', url: 'https://www.wowhead.com' },
          { title: 'Raider.IO', url: 'https://raider.io' },
          { title: 'Warcraft Logs', url: 'https://www.warcraftlogs.com' },
          { title: 'Icy Veins', url: 'https://www.icy-veins.com/wow/' },
        ],
      },
      {
        title: 'Diablo',
        bookmarks: [
          { title: 'Maxroll', url: 'https://maxroll.gg/d4' },
          { title: 'D4Builds', url: 'https://d4builds.gg' },
          { title: 'Diablo Trade', url: 'https://diablo.trade' },
        ],
      },
      {
        title: 'Dota 2',
        bookmarks: [
          { title: 'Dotabuff', url: 'https://www.dotabuff.com' },
          { title: 'Dota 2 Pro Tracker', url: 'https://dota2protracker.com' },
          { title: 'Liquipedia', url: 'https://liquipedia.net/dota2' },
        ],
      },
      {
        title: 'FFXIV',
        bookmarks: [
          { title: 'The Lodestone', url: 'https://na.finalfantasyxiv.com/lodestone/' },
          { title: 'Universalis', url: 'https://universalis.app' },
          { title: 'Garland Tools', url: 'https://garlandtools.org' },
          { title: 'Icy Veins FFXIV', url: 'https://www.icy-veins.com/ffxiv/' },
        ],
      },
    ],
  },
];
