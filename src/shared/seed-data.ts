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

/** A folder that may hold bookmarks directly and/or nested subfolders. */
export interface FolderSeed {
  title: string;
  bookmarks?: BookmarkSeed[];
  subfolders?: SubFolderSeed[];
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

// ─── ~100-bookmark single-workspace world ───────────────────────────────────

export const ROOT_BOOKMARKS: BookmarkSeed[] = [
  { title: 'Gmail', url: 'https://mail.google.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'Reddit', url: 'https://www.reddit.com' },
  { title: 'X', url: 'https://x.com' },
  { title: 'Netflix', url: 'https://www.netflix.com' },
  { title: 'Spotify', url: 'https://open.spotify.com' },
  { title: 'Notion', url: 'https://www.notion.so' },
  { title: 'Amazon', url: 'https://www.amazon.com' },
  { title: 'ChatGPT', url: 'https://chat.openai.com' },
  { title: 'Claude', url: 'https://claude.ai' },
  { title: 'Discord', url: 'https://discord.com' },
  { title: 'LinkedIn', url: 'https://www.linkedin.com' },
  { title: 'Google Drive', url: 'https://drive.google.com' },
  { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
  { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { title: 'Slack', url: 'https://slack.com' },
];

export const FOLDERS: FolderSeed[] = [
  {
    title: '💻 Dev Tools',
    subfolders: [
      {
        title: '⚛️ Frameworks',
        bookmarks: [
          { title: 'React', url: 'https://react.dev' },
          { title: 'Vue', url: 'https://vuejs.org' },
          { title: 'Svelte', url: 'https://svelte.dev' },
          { title: 'Angular', url: 'https://angular.dev' },
          { title: 'Next.js', url: 'https://nextjs.org' },
          { title: 'Astro', url: 'https://astro.build' },
        ],
      },
      {
        title: '📜 Languages',
        bookmarks: [
          { title: 'TypeScript', url: 'https://www.typescriptlang.org' },
          { title: 'Python', url: 'https://www.python.org' },
          { title: 'Rust', url: 'https://www.rust-lang.org' },
          { title: 'Go', url: 'https://go.dev' },
          { title: 'Kotlin', url: 'https://kotlinlang.org' },
        ],
      },
      {
        title: '🛠️ Tools',
        bookmarks: [
          { title: 'GitHub', url: 'https://github.com' },
          { title: 'GitLab', url: 'https://gitlab.com' },
          { title: 'Linear', url: 'https://linear.app' },
          { title: 'Vercel', url: 'https://vercel.com' },
          { title: 'Cloudflare', url: 'https://www.cloudflare.com' },
          { title: 'Sentry', url: 'https://sentry.io' },
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
          { title: 'Netflix', url: 'https://www.netflix.com' },
          { title: 'YouTube', url: 'https://www.youtube.com' },
          { title: 'Twitch', url: 'https://www.twitch.tv' },
          { title: 'Disney+', url: 'https://www.disneyplus.com' },
          { title: 'HBO Max', url: 'https://www.max.com' },
          { title: 'Apple TV+', url: 'https://tv.apple.com' },
        ],
      },
      {
        title: '🎵 Music',
        bookmarks: [
          { title: 'Spotify', url: 'https://open.spotify.com' },
          { title: 'SoundCloud', url: 'https://soundcloud.com' },
          { title: 'Apple Music', url: 'https://music.apple.com' },
          { title: 'YouTube Music', url: 'https://music.youtube.com' },
        ],
      },
      {
        title: '📖 Reading',
        bookmarks: [
          { title: 'Medium', url: 'https://medium.com' },
          { title: 'Substack', url: 'https://substack.com' },
          { title: 'Audible', url: 'https://www.audible.com' },
          { title: 'Kindle Cloud Reader', url: 'https://read.amazon.com' },
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
          { title: 'Gmail', url: 'https://mail.google.com' },
          { title: 'Proton Mail', url: 'https://mail.proton.me' },
          { title: 'Outlook', url: 'https://outlook.live.com' },
        ],
      },
      {
        title: '📝 Docs',
        bookmarks: [
          { title: 'Notion', url: 'https://www.notion.so' },
          { title: 'Google Docs', url: 'https://docs.google.com' },
          { title: 'Proton Drive', url: 'https://drive.proton.me' },
          { title: 'Google Drive', url: 'https://drive.google.com' },
          { title: 'Dropbox', url: 'https://www.dropbox.com' },
        ],
      },
    ],
    bookmarks: [
      { title: 'Google Calendar', url: 'https://calendar.google.com' },
      { title: 'Google Keep', url: 'https://keep.google.com' },
      { title: 'Obsidian', url: 'https://obsidian.md' },
    ],
  },
  {
    title: '👥 Social',
    bookmarks: [
      { title: 'Reddit', url: 'https://www.reddit.com' },
      { title: 'X', url: 'https://x.com' },
      { title: 'LinkedIn', url: 'https://www.linkedin.com' },
      { title: 'Discord', url: 'https://discord.com' },
      { title: 'Bluesky', url: 'https://bsky.app' },
      { title: 'Mastodon', url: 'https://mastodon.social' },
      { title: 'Threads', url: 'https://www.threads.net' },
    ],
  },
  {
    title: '📰 News',
    subfolders: [
      {
        title: '🖥️ Tech',
        bookmarks: [
          { title: 'TechCrunch', url: 'https://techcrunch.com' },
          { title: 'The Verge', url: 'https://www.theverge.com' },
          { title: 'Ars Technica', url: 'https://arstechnica.com' },
          { title: 'Wired', url: 'https://www.wired.com' },
        ],
      },
      {
        title: '🌍 World',
        bookmarks: [
          { title: 'BBC News', url: 'https://www.bbc.com/news' },
          { title: 'NPR', url: 'https://www.npr.org' },
          { title: 'The Guardian', url: 'https://www.theguardian.com' },
          { title: 'Reuters', url: 'https://www.reuters.com' },
          { title: 'New York Times', url: 'https://www.nytimes.com' },
        ],
      },
    ],
  },
  {
    title: '🛍️ Shopping',
    bookmarks: [
      { title: 'Amazon', url: 'https://www.amazon.com' },
      { title: 'Etsy', url: 'https://www.etsy.com' },
      { title: 'eBay', url: 'https://www.ebay.com' },
      { title: 'Best Buy', url: 'https://www.bestbuy.com' },
      { title: 'Wirecutter', url: 'https://www.nytimes.com/wirecutter' },
      { title: 'IKEA', url: 'https://www.ikea.com' },
    ],
  },
  {
    title: '🤖 AI',
    bookmarks: [
      { title: 'Claude', url: 'https://claude.ai' },
      { title: 'ChatGPT', url: 'https://chat.openai.com' },
      { title: 'Perplexity', url: 'https://www.perplexity.ai' },
      { title: 'Gemini', url: 'https://gemini.google.com' },
      { title: 'Midjourney', url: 'https://www.midjourney.com' },
      { title: 'Mistral', url: 'https://mistral.ai' },
      { title: 'Deepseeker', url: 'https://chat.deepseek.com' },
    ],
  },
  {
    title: '🍳 Cooking',
    bookmarks: [
      { title: 'AllRecipes', url: 'https://www.allrecipes.com' },
      { title: 'Serious Eats', url: 'https://www.seriouseats.com' },
      { title: 'NYT Cooking', url: 'https://cooking.nytimes.com' },
      { title: 'Bon Appétit', url: 'https://www.bonappetit.com' },
    ],
  },
  {
    title: '✈️ Travel',
    bookmarks: [
      { title: 'Airbnb', url: 'https://www.airbnb.com' },
      { title: 'Booking.com', url: 'https://www.booking.com' },
      { title: 'Google Flights', url: 'https://www.google.com/travel/flights' },
      { title: 'Tripadvisor', url: 'https://www.tripadvisor.com' },
    ],
  },
  {
    title: '📚 Reference',
    bookmarks: [
      { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
      { title: 'Stack Overflow', url: 'https://stackoverflow.com' },
      { title: 'MDN Docs', url: 'https://developer.mozilla.org' },
      { title: 'Wolfram Alpha', url: 'https://www.wolframalpha.com' },
    ],
  },
  {
    title: '💰 Finance',
    bookmarks: [
      { title: 'Chase', url: 'https://www.chase.com' },
      { title: 'PayPal', url: 'https://www.paypal.com' },
      { title: 'Wise', url: 'https://wise.com' },
      { title: 'Trade Republic', url: 'https://traderepublic.com' },
    ],
  },
];

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
