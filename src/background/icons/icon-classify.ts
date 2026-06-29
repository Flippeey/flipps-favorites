import type { IconSearchCandidate } from '@/shared/messages';
import { faviconProviderUrl } from './icon-constants';
import { extractBrandInfo, stripKnownVanityPrefix } from '@/shared/url-brand';
import { getRegistrableDomain, getRootLabel } from '@/shared/icon-scope';

// Re-exported under the legacy name so backend callers + tests keep importing it
// from here. The implementation now lives in shared/url-brand so the edit dialog
// can seed its search box with the exact same subdomain-aware query.
export { buildBrandSearchQuery as buildSearchQueryFromBookmark } from '@/shared/url-brand';

// ---------------------------------------------------------------------------
// DDG scoring constants
//
// Invariant: PENALTY_FOREIGN_BRAND_IMAGE must exceed the max possible
// same-domain affinity bonus (source exact-host 400 + image exact-host 300
// = 700) so a foreign-brand image on the bookmark's own site can never
// outrank a correct off-domain candidate purely through domain affinity.
// ---------------------------------------------------------------------------

// Bonuses (positive)
const BONUS_LOGO_AGGREGATOR = 600;          // seeklogo, brandslogos, etc.
const BONUS_LOGO_DIR_PATH = 400;            // /icons/, /logos/ in image URL
const BONUS_SVG_FORMAT = 500;               // .svg image (vector = high quality)
const BONUS_SQUARE_ASPECT = 300;            // 1:1 aspect ratio
const BONUS_NEAR_SQUARE_ASPECT = 150;       // nearly square (< 1.15)
const BONUS_LOGO_IN_IMAGE_PATH = 300;       // icon/logo/favicon in image URL
const BONUS_BRAND_IN_SOURCE_HOST = 350;     // brand as token in source hostname
const BONUS_BRAND_IN_IMAGE_HOST = 260;      // brand as token in image hostname
const BONUS_BRAND_IN_TITLE = 220;           // brand in page title
const BONUS_LOGO_IN_TITLE = 140;            // "logo"/"icon" in page title

// Penalties (negative)
const PENALTY_FOREIGN_BRAND_IMAGE = -800;   // foreign brand name adjacent to "logo" in image filename
const PENALTY_PEOPLE_CONTENT = -700;        // founders/team/staff/testimonial in image path
const PENALTY_H2_QUALIFIED_SLUG = -700;     // aggregator slug has foreign qualifier (takie-dela)
const PENALTY_SCREENSHOT_IMAGE = -600;      // screenshot/banner/header/cover/hero in image URL
const PENALTY_SCREENSHOT_TITLE = -400;      // screenshot/banner/cover/hero in title
const PENALTY_NO_BRAND_SIGNAL = -400;       // same-domain image with no brand or logo signal
const PENALTY_H2_ABSENT_SLUG = -300;        // brand absent from aggregator slug
const PENALTY_BRAND_NO_LOGO_TOKEN = -250;   // same-domain brand in filename but no logo/icon token
const PENALTY_LIKELY_AGGREGATOR = -1500;    // pinterest, wikimedia, etc.

export function getIconLabel(bookmarkTitle: string | undefined, bookmarkUrl: string): string {
  const trimmedTitle = bookmarkTitle?.trim();
  if (trimmedTitle) {
    return trimmedTitle;
  }

  try {
    const hostname = new URL(bookmarkUrl).hostname.replace(/^www\./, '');
    return hostname || 'Link';
  } catch {
    return 'Link';
  }
}

export function extractHostname(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.replace(/^www\./, '') || null;
  } catch {
    try {
      return new URL(`https://${value}`).hostname.replace(/^www\./, '') || null;
    } catch {
      return null;
    }
  }
}

export function getDomainCandidates(bookmarkUrl: string): IconSearchCandidate[] {
  const hostname = extractHostname(bookmarkUrl);
  if (!hostname) {
    return [];
  }

  return [{
    imageUrl: `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=256`,
    previewUrl: `${faviconProviderUrl}?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=128`,
    label: hostname,
    sourceKind: 'favicon',
    sourcePageUrl: `https://${hostname}`,
  }];
}

export function dedupeIconCandidates(candidates: IconSearchCandidate[]): IconSearchCandidate[] {
  const unique = new Map<string, IconSearchCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.imageUrl)) {
      unique.set(candidate.imageUrl, candidate);
    }
  }
  return Array.from(unique.values());
}

export function clampFaviconSize(value: number): number {
  const rounded = Math.round(value);
  return Math.max(128, Math.min(256, rounded));
}

export function scoreDuckDuckGoResult(
  result: { image: string; thumbnail: string; title: string; url: string; width: number; height: number },
  bookmarkHostname: string | null,
  queryTerms: string[],
): number {
  let score = 0;
  const sourceHostname = extractHostname(result.url);
  const imageHostname = extractHostname(result.image);
  const normalizedTitle = stripHtml(result.title).toLowerCase();
  const imageArea = result.width * result.height;
  const aspectRatio = Math.max(result.width, result.height) / Math.max(1, Math.min(result.width, result.height));

  // --- Domain affinity (B): strong signal for registrable-domain match ---
  // Uses getRegistrableDomain from icon-scope (handles co.uk etc.) for precise
  // registrable-domain comparison, plus getDomainRoot as a simpler fallback for
  // the existing exact-host / root-label checks.
  let hasDomainAffinity = false;
  if (bookmarkHostname) {
    const bookmarkRoot = getDomainRoot(bookmarkHostname);
    const sourceRoot = getDomainRoot(sourceHostname);
    const imageRoot = getDomainRoot(imageHostname);
    const bookmarkRegistrable = getRegistrableDomain(bookmarkHostname);
    const sourceRegistrable = getRegistrableDomain(sourceHostname);
    const imageRegistrable = getRegistrableDomain(imageHostname);

    if (sourceHostname === bookmarkHostname) {
      score += 400;
      hasDomainAffinity = true;
    } else if (sourceRegistrable && bookmarkRegistrable && sourceRegistrable === bookmarkRegistrable) {
      score += 300;
      hasDomainAffinity = true;
    } else if (sourceRoot && bookmarkRoot && sourceRoot === bookmarkRoot) {
      score += 200;
      hasDomainAffinity = true;
    }

    if (imageHostname === bookmarkHostname) {
      score += 300;
      hasDomainAffinity = true;
    } else if (imageRegistrable && bookmarkRegistrable && imageRegistrable === bookmarkRegistrable) {
      score += 200;
      hasDomainAffinity = true;
    } else if (imageRoot && bookmarkRoot && imageRoot === bookmarkRoot) {
      score += 150;
      hasDomainAffinity = true;
    }
  }

  const isAggregator = isLogoAggregatorHost(sourceHostname) || isLogoAggregatorHost(imageHostname);
  if (isAggregator) {
    score += BONUS_LOGO_AGGREGATOR;
  }

  // --- Brand-term matching: use word-boundary matching (A) ---
  let hasBrandMatch = false;
  for (const term of queryTerms) {
    if (normalizedTitle.includes(term)) {
      score += BONUS_BRAND_IN_TITLE;
    }
    if (sourceHostname && brandMatchesAsToken(term, sourceHostname)) {
      score += BONUS_BRAND_IN_SOURCE_HOST;
      hasBrandMatch = true;
    } else if (sourceHostname?.includes(term)) {
      // Substring-only match (no word boundary) gets a smaller bonus
      score += 100;
    }
    if (imageHostname && brandMatchesAsToken(term, imageHostname)) {
      score += BONUS_BRAND_IN_IMAGE_HOST;
      hasBrandMatch = true;
    } else if (imageHostname?.includes(term)) {
      score += 80;
    }
  }

  if (/logo|icon|brand|symbol/i.test(normalizedTitle)) {
    score += BONUS_LOGO_IN_TITLE;
  }

  if (/icon|logo|favicon|apple-touch-icon/i.test(result.image)) {
    score += BONUS_LOGO_IN_IMAGE_PATH;
  }

  if (/screenshot|banner|header|cover|hero/i.test(result.image)) {
    score += PENALTY_SCREENSHOT_IMAGE;
  }

  if (/screenshot|banner|cover|hero/i.test(normalizedTitle)) {
    score += PENALTY_SCREENSHOT_TITLE;
  }

  // People-content images: filenames suggesting photos of people rather than logos
  if (isPeopleContentImage(result.image)) {
    score += PENALTY_PEOPLE_CONTENT;
  }

  // --- Gate aspect/logo/SVG bonuses behind relevance (C) ---
  // These visual-quality bonuses apply fully only when the candidate has domain
  // affinity or a word-boundary brand match. Without either, they are reduced
  // so an unrelated square logo cannot outrank a relevant candidate.
  const isRelevant = hasDomainAffinity || hasBrandMatch;

  if (/\/(icons?|logos?|favicons?|brand|assets?\/(icon|logo|brand))\//i.test(result.image)) {
    score += isRelevant ? BONUS_LOGO_DIR_PATH : 80;
  }

  if (/\.svg(?:$|\?)/i.test(result.image)) {
    score += isRelevant ? BONUS_SVG_FORMAT : 100;
  }

  if (aspectRatio <= 1.05) {
    score += isRelevant ? BONUS_SQUARE_ASPECT : 60;
  } else if (aspectRatio <= 1.15) {
    score += isRelevant ? BONUS_NEAR_SQUARE_ASPECT : 30;
  }

  if (imageArea >= 256 * 256 && imageArea <= 1200 * 1200) {
    score += 180;
  } else {
    score += Math.min(120, Math.round(imageArea / 20000));
  }

  if (isLikelyAggregatorHost(sourceHostname) || isLikelyAggregatorHost(imageHostname)) {
    score += PENALTY_LIKELY_AGGREGATOR;
  }

  // --- H1: Same-domain content-image rejection ---
  // When domain affinity is the primary relevance signal, verify the image
  // itself depicts this brand. A same-domain staff photo, screenshot, or
  // partner logo (e.g. Rabobank-Logo on twinq.nl) should not win just
  // because the page host matches.
  if (hasDomainAffinity && queryTerms.length > 0) {
    const primaryBrand = queryTerms[0];
    const foreignBrand = detectForeignBrandInImage(result.image, primaryBrand);
    if (foreignBrand) {
      // Image filename names a different brand (e.g. "Rabobank-Logo") — heavy penalty
      score += PENALTY_FOREIGN_BRAND_IMAGE;
    } else if (!sameDomainImageHasBrandSignal(result.image, primaryBrand)) {
      // No brand token and no logo-path signal — strip most of the affinity bonus
      score += PENALTY_NO_BRAND_SIGNAL;
    } else {
      // Brand IS in image path, but for same-domain images without an explicit
      // logo/icon path token, apply a moderate penalty. This pushes blog photos
      // named "twinq.jpg" below off-domain candidates with logo paths like
      // "logo.png" or "twinq-logo.png".
      const imagePath = extractImagePath(result.image);
      const filenameTokens = imagePath
        .replace(/.*\//, '')
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .split(/[-_]+/);
      const hasExplicitLogoToken = filenameTokens.some(t =>
        /^(logo|icon|favicon|brand|symbol)s?$/.test(t),
      );
      if (!hasExplicitLogoToken) {
        score += PENALTY_BRAND_NO_LOGO_TOKEN;
      }
    }
  }

  // --- H2: Aggregator wrong-entity disambiguation ---
  // For logo-aggregator hosts, check whether the brand is the leading token
  // in the image/page slug, or preceded by a foreign qualifier that indicates
  // a different entity (e.g. "takie-dela" vs "dela-verzekeringen").
  if (isAggregator && queryTerms.length > 0) {
    const primaryBrand = queryTerms[0];
    const slugPosition = analyzeAggregatorSlug(result.image, result.url, primaryBrand);
    if (slugPosition === 'qualified') {
      // Brand is preceded by a foreign qualifier — this is likely a different entity
      score += PENALTY_H2_QUALIFIED_SLUG;
    } else if (slugPosition === 'absent') {
      // Brand not in slug at all — reduce aggregator trust
      score += PENALTY_H2_ABSENT_SLUG;
    }
  }

  return score;
}

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(part => part.trim())
    .filter(part => part.length >= 3)
    .filter(part => part !== 'logo' && part !== 'icon');
}

// True when fetching https://<requestedHostname>/ ended on a different registrable
// domain (dev.azure.com -> login.microsoftonline.com). The final page is then a
// login/SSO provider, and its icons describe the wrong brand.
export function isCrossRootRedirect(requestedHostname: string, finalUrl: string): boolean {
  const finalHostname = extractHostname(finalUrl);
  if (!finalHostname) return false;
  const requestedRoot = getDomainRoot(requestedHostname.replace(/^www\./, ''));
  const finalRoot = getDomainRoot(finalHostname);
  return Boolean(requestedRoot && finalRoot && requestedRoot !== finalRoot);
}

export function getDomainRoot(hostname: string | null): string | null {
  if (!hostname) {
    return null;
  }

  const parts = hostname.split('.').filter(Boolean);
  if (parts.length < 2) {
    return hostname;
  }

  return parts.slice(-2).join('.');
}

export function isLikelyAggregatorHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  return [
    'pinterest.',
    'pinimg.',
    'wikimedia.',
    'wikipedia.',
    'fandom.',
    'bing.',
    'msn.',
    'redd.it',
  ].some(fragment => hostname.includes(fragment));
}

export function isLogoAggregatorHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  return [
    'seeklogo.',
    'vectorseek.',
    'brandslogos.',
    'pngwing.',
    'worldvectorlogo.',
    'logos-world.',
    'logos-download.',
    'logodownload.',
    'logo.wine',
    'logosvector.',
    'logotyp.us',
    'cdn.worldvectorlogo.',
    'brandlogos.',
    'freebiesupply.',
    'logoeps.',
  ].some(fragment => hostname.includes(fragment));
}

export function isStockPhotoHost(hostname: string | null): boolean {
  if (!hostname) {
    return false;
  }

  return [
    'alamy.',
    'shutterstock.',
    'gettyimages.',
    'istockphoto.',
    'dreamstime.',
    'depositphotos.',
    '123rf.',
    'vectorstock.',
    'freepik.',
    'adobestock.',
    'stock.adobe.',
    'canstockphoto.',
    'bigstockphoto.',
    'vecteezy.',
  ].some(fragment => hostname.includes(fragment));
}

export function isCollageTitle(title: string): boolean {
  const lowered = title.toLowerCase();
  return /\b(set|collection|various|bundle|pack|collage|montage|assorted|logos\s+pack|icons\s+set|logo\s+set)\b/.test(lowered);
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

/**
 * True when `brand` appears as a whole token in `text`, delimited by
 * non-alphanumeric boundaries (start/end of string, `.`, `-`, `/`, `_`, space,
 * etc.). Prevents "dela" matching inside "takiedela".
 */
export function brandMatchesAsToken(brand: string, text: string): boolean {
  if (!brand || !text) return false;
  // Escape regex-special chars in the brand, then require word-boundary-like
  // delimiters: start/end of string OR any non-alphanumeric character.
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i');
  if (pattern.test(text)) return true;

  // Compound brands whose registrable label is concatenated (e.g. "producthunt",
  // "lastepochtools") are routinely rendered with the word break restored —
  // "Product Hunt", "product-hunt-logo.png" — which the token regex above cannot
  // match. Fall back to a separator-collapsed substring test. Length-gated to
  // >= 6 chars so short brands can't substring-collide (e.g. "art" in "cart").
  // Strip ONLY intra-word joiners (hyphen, underscore, whitespace), never path or
  // host separators ('/', '.', ':') — otherwise a brand could match across URL
  // boundaries (e.g. "foobar" inside ".../foo/bar.png").
  const collapse = (value: string): string => value.toLowerCase().replace(/[-_\s]+/g, '');
  const collapsedBrand = collapse(brand);
  if (collapsedBrand.length >= 6) {
    return collapse(text).includes(collapsedBrand);
  }
  return false;
}

// ---------------------------------------------------------------------------
// People-content image detection
// ---------------------------------------------------------------------------

/**
 * True when the image URL path/filename contains tokens that indicate photos of
 * people rather than logos. Catches: founders, team, staff, people, headshot,
 * portrait, employee, testimonial, about-us. These are content photos, never
 * logo/icon candidates.
 */
export function isPeopleContentImage(imageUrl: string): boolean {
  // Check both the pathname and decoded full URL (for Next.js /_next/image?url=... patterns
  // where the real image path is URL-encoded in a query parameter)
  let textToCheck: string;
  try {
    const parsed = new URL(imageUrl);
    textToCheck = decodeURIComponent(parsed.pathname + parsed.search);
  } catch {
    textToCheck = imageUrl;
  }
  return /(?:^|[/\-_.])(?:founders?|team|staff|people|headshots?|portraits?|employees?|testimonials?|about[-_]?us|medewerkers?|leadership|management|profile|avatars?|persons?|our[-_]?people)(?:$|[/\-_.])/i.test(textToCheck);
}

// ---------------------------------------------------------------------------
// H1 — Same-domain content-image analysis helpers
// ---------------------------------------------------------------------------

/** Extract just the path from a URL (for same-domain checks where hostname is circular). */
function extractImagePath(imageUrl: string): string {
  try {
    return new URL(imageUrl).pathname;
  } catch {
    return imageUrl;
  }
}

/** True when the image URL path contains a generic logo/icon/favicon signal. */
function hasLogoPathSignal(imageUrl: string): boolean {
  return /(?:logo|icon|favicon|apple-touch-icon|android-chrome)/i.test(imageUrl);
}

/**
 * Detects foreign brand names adjacent to "logo" in the image filename/path.
 * Catches both `<token>-logo` and `logo-<token>` patterns (e.g.
 * `Rabobank-Logo.jpg`, `logo-abn-amro.jpg`). The token must be an alpha string
 * >= 3 chars that is NOT the bookmark brand. Returns the foreign token if found,
 * null otherwise.
 */
export function detectForeignBrandInImage(imageUrl: string, brand: string): string | null {
  if (!brand || brand.length < 3) return null;
  // Extract the filename portion of the URL path
  const pathMatch = imageUrl.match(/\/([^/?#]+)$/);
  if (!pathMatch) return null;
  const filename = pathMatch[1].toLowerCase();
  const brandLower = brand.toLowerCase();

  // If the bookmark's own brand IS present in the filename, this is an own-brand
  // image — even if another token sits next to "logo". e.g. "stripe-payments-logo.png"
  // for brand "stripe" is the brand's own product-qualified logo, not foreign.
  if (filename.includes(brandLower)) return null;

  const genericTokens = new Set([
    // Generic descriptors / file words
    'the', 'free', 'vector', 'png', 'svg', 'transparent', 'design', 'icon', 'brand',
    'images', 'large', 'small', 'logo', 'new', 'old', 'copy', 'day',
    // Layout / placement descriptors (e.g. "main-logo.png", "header-logo.svg").
    // These are NOT brand names, so an own-domain logo file prefixed with one
    // must not be misclassified as a foreign brand and rejected.
    'main', 'header', 'footer', 'site', 'top', 'nav', 'navbar', 'primary', 'secondary', 'default',
    // Color / style / variant descriptors (e.g. "color-logo", "dark-logo", "white-logo").
    'color', 'colour', 'white', 'black', 'dark', 'light', 'grey', 'gray', 'mono', 'full', 'flat',
    'horizontal', 'vertical', 'stacked', 'wordmark', 'inverted', 'official',
  ]);

  // Only the token IMMEDIATELY adjacent to "logo" is treated as a candidate
  // foreign brand. Scanning further back wrongly flags own-product tokens in a
  // legit same-domain logo file (e.g. "firefox" in "firefox-parent-brand-logo"
  // on mozilla.org). The trade-off: a competitor brand separated from "logo" by a
  // (now-generic) descriptor — "rabobank-white-logo" — slips through. That edge
  // case is far rarer than the layout-prefix false-positives the denylist fixes.
  // Pattern 1: <token>-logo, <token>_logo, <token>logo
  const beforeLogo = /([a-z]{3,})[-_]?logo/gi;
  let match: RegExpExecArray | null;
  while ((match = beforeLogo.exec(filename)) !== null) {
    const token = match[1].toLowerCase();
    if (token !== brandLower && !genericTokens.has(token)) {
      return token;
    }
  }

  // Pattern 2: logo-<token>, logo_<token> (e.g. logo-abn-amro.jpg)
  const afterLogo = /logo[-_]([a-z]{3,})/gi;
  while ((match = afterLogo.exec(filename)) !== null) {
    const token = match[1].toLowerCase();
    if (token !== brandLower && !genericTokens.has(token)) {
      return token;
    }
  }

  return null;
}

/**
 * For same-domain candidates: true when the image is likely a brand logo, not
 * a content image (event photo, screenshot, blog hero) that happens to live on
 * the same domain. Checks only the URL path (not hostname — that's circular).
 *
 * Accepts when:
 * - The filename itself is a logo/icon path (apple-touch-icon, favicon, etc.)
 * - The brand is the PRIMARY token in a short filename that looks like a logo
 *   file (e.g. `twinq.png`, `twinq-logo.png`, `logo-twinq.svg`)
 *
 * Rejects when:
 * - No brand token in path at all
 * - Brand is present but buried in a multi-token content filename (e.g.
 *   `TEN31-TwinQ.jpg`, `Twinq-Connect-2-47.jpg`, `Twinq-ambassadeurs-...`)
 *   which are event photos, blog images, or partner assets
 */
function sameDomainImageHasBrandSignal(imageUrl: string, brand: string): boolean {
  if (!brand || brand.length < 3) return true; // can't gate short brands
  let path: string;
  try {
    path = new URL(imageUrl).pathname;
  } catch {
    path = imageUrl;
  }

  // Generic logo/icon paths at well-known locations are always OK.
  // Match whole-filename patterns: /logo.png, /icon.svg, /apple-touch-icon.png
  if (/\/(apple-touch-icon[^/]*|favicon[^/]*|android-chrome[^/]*|logo|icon)\.[a-z]+$/i.test(path)) return true;

  // Extract just the filename (last segment, strip extension)
  const filenameMatch = path.match(/\/([^/?#]+?)(?:\.[^./?#]+)?$/);
  if (!filenameMatch) return false;
  const filename = filenameMatch[1].toLowerCase();
  const brandLower = brand.toLowerCase();

  // Brand must appear in the filename
  if (!filename.includes(brandLower)) return false;

  // Split filename into semantic tokens (on hyphens, underscores, camelCase boundaries)
  const tokens = filename
    .replace(/([a-z])([A-Z])/g, '$1-$2') // split camelCase
    .split(/[-_]+/)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t)); // drop pure numbers

  // Logo-indicator tokens in the filename
  const hasLogoToken = tokens.some(t => /^(logo|icon|favicon|brand|symbol)s?$/.test(t));

  // If the filename has a logo indicator, it's likely a logo file
  if (hasLogoToken) return true;

  // For filenames WITHOUT a logo indicator: only accept if the brand is the
  // sole meaningful token. Content images like "TEN31-TwinQ.jpg" or
  // "Twinq-Connect-2-47.jpg" have multiple semantic tokens — reject them.
  const semanticTokens = tokens.filter(t =>
    !/^(wp|content|uploads?|images?|assets?|media|static|dist|public|img|pics?|photos?)$/.test(t)
    && !/^\d{4,}$/.test(t) // date-like numbers
    && !/^(scaled|e\d+|x\d+|\d+x\d+)$/.test(t) // WordPress suffixes
  );

  // Brand-only filename: accept only when the brand is the SOLE semantic token,
  // or accompanied only by a version/size suffix (twinq-2-1 → brand + numbers).
  const nonBrandTokens = semanticTokens.filter(t => t !== brandLower && !t.startsWith(brandLower));
  // All non-brand tokens are just numbers/versions (e.g. twinq-2-1)
  const nonBrandAreNumeric = nonBrandTokens.every(t => /^\d+$/.test(t));

  if (nonBrandTokens.length === 0 || nonBrandAreNumeric) {
    return true;
  }

  // Other semantic tokens present (partner names, event names, descriptors) —
  // this is a content image, not a standalone brand logo
  return false;
}

/**
 * STRICT gate variant for same-domain images in `isDdgFirstHitRelevant`.
 * Stricter than `sameDomainImageHasBrandSignal` (used in scoring) — rejects
 * multi-token content filenames (TEN31-TwinQ.jpg, Twinq-ambassadeurs-...) but
 * accepts brand-only filenames (spotify.png, github.png) where the brand is the
 * sole semantic token, since those are typically actual logo files.
 *
 * Accepts when:
 * - Well-known logo path (apple-touch-icon, favicon, /logo.png, /icon.svg)
 * - Filename contains brand + explicit logo/icon token (twinq-logo.png)
 * - Image URL path contains a /logo/ or /icons/ directory segment
 * - Brand is the sole semantic token in the filename (spotify.png, github.png)
 *
 * Rejects multi-token content filenames where brand is mixed with other tokens.
 */
function sameDomainImageHasLogoSignal(imageUrl: string, brand: string): boolean {
  if (!brand || brand.length < 3) return true;
  let path: string;
  try {
    path = new URL(imageUrl).pathname;
  } catch {
    path = imageUrl;
  }

  // Well-known logo paths at root or standard locations
  if (/\/(apple-touch-icon[^/]*|favicon[^/]*|android-chrome[^/]*|logo|icon)\.[a-z]+$/i.test(path)) return true;

  // Logo/icon directory in the path
  if (/\/(icons?|logos?|favicons?|brand|assets?\/(icon|logo|brand))\//i.test(path)) return true;

  // Filename analysis
  const filenameMatch = path.match(/\/([^/?#]+?)(?:\.[^./?#]+)?$/);
  if (!filenameMatch) return false;
  const filename = filenameMatch[1].toLowerCase();
  const brandLower = brand.toLowerCase();

  // Split into tokens
  const tokens = filename
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .split(/[-_]+/)
    .filter(t => t.length >= 2 && !/^\d+$/.test(t));

  // Explicit logo/icon/brand token in the filename — accept even when the domain
  // brand is absent, UNLESS a foreign brand is detected. A file named
  // "Firefox-parent-brand-logo.png" on mozilla.org is virtually always the site's
  // own logo (no foreign brand). But "Rabobank-Logo.png" on twinq.nl has
  // "rabobank" as a foreign brand adjacent to "logo" — reject it.
  // This check is needed because isDdgFirstHitRelevant suppresses
  // detectForeignBrandInImage for same-domain images (the brand controls the
  // origin, so product names like "widget" shouldn't trigger rejection).
  // The foreign-brand check here is the secondary defense for genuine competitor
  // logos hosted on the brand's own site.
  const hasLogoToken = tokens.some(t => /^(logo|icon|favicon|brand|symbol)s?$/.test(t));
  if (hasLogoToken && !filename.includes(brandLower)) {
    // Logo token present, brand absent: accept only if no foreign brand detected.
    // "Firefox-parent-brand-logo" → no foreign brand → accept
    // "Rabobank-Logo" → "rabobank" is foreign → reject
    const foreignBrand = detectForeignBrandInImage(imageUrl, brand);
    return foreignBrand === null;
  }
  if (!filename.includes(brandLower)) return false;

  // Explicit logo indicator alongside brand — always accept
  if (hasLogoToken) return true;

  // Brand-only filename: accept when brand is the sole semantic token (mirrors
  // sameDomainImageHasBrandSignal logic). spotify.png, github.png are legit logos.
  // Multi-token filenames (TEN31-TwinQ.jpg, Twinq-Connect-2-47.jpg) are rejected.
  const semanticTokens = tokens.filter(t =>
    !/^(wp|content|uploads?|images?|assets?|media|static|dist|public|img|pics?|photos?)$/.test(t)
    && !/^\d{4,}$/.test(t)
    && !/^(scaled|e\d+|x\d+|\d+x\d+)$/.test(t)
  );
  const nonBrandTokens = semanticTokens.filter(t => t !== brandLower && !t.startsWith(brandLower));
  const nonBrandAreNumeric = nonBrandTokens.every(t => /^\d+$/.test(t));

  if (nonBrandTokens.length === 0 || nonBrandAreNumeric) {
    // Brand is sole semantic token — but reject if it's in a date-stamped
    // upload directory (WordPress /uploads/YYYY/MM/ etc.). Real logos live in
    // /assets/, /images/, /static/ — not date-bucketed CMS upload paths.
    // Prevents blog/event photos named after the brand from passing.
    const isDateStampedUpload = /\/uploads\/\d{4}\/\d{2}\//i.test(path);
    return !isDateStampedUpload;
  }

  return false;
}

// ---------------------------------------------------------------------------
// H2 — Aggregator wrong-entity slug analysis helpers
// ---------------------------------------------------------------------------

/**
 * For logo-aggregator image URLs: checks whether the brand token appears in
 * the image path slug, and whether it's preceded by a foreign qualifier.
 *
 * Returns:
 * - `'leading'` — brand is the first/standalone slug token (e.g. `dela-logo`)
 * - `'qualified'` — brand appears but is preceded by a foreign token
 *   (e.g. `takie-dela-logo` — this is a different entity)
 * - `'absent'` — brand does not appear in the slug at all
 */
export function analyzeAggregatorSlug(
  imageUrl: string,
  sourcePageUrl: string,
  brand: string,
): 'leading' | 'qualified' | 'absent' {
  if (!brand || brand.length < 3) return 'leading';
  const brandLower = brand.toLowerCase();

  // Check both the image URL path and the source page URL path
  for (const url of [imageUrl, sourcePageUrl]) {
    const pathMatch = url.match(/\/([^/?#]+?)(?:\.[^./?#]+)?$/);
    if (!pathMatch) continue;
    const slug = pathMatch[1].toLowerCase();
    if (!slug.includes(brandLower)) continue;

    // Split slug into tokens on hyphen/underscore
    const tokens = slug.split(/[-_]+/).filter(t => t.length >= 2);
    const brandIndex = tokens.findIndex(t => t === brandLower || t.startsWith(brandLower));
    if (brandIndex < 0) continue;

    // If there's a preceding alpha token (>= 3 chars) that is NOT a generic term,
    // this is a qualified/compound entity name (e.g. "takie-dela")
    if (brandIndex > 0) {
      const preceding = tokens[brandIndex - 1];
      const genericPrefixes = new Set(['the', 'logo', 'icon', 'brand', 'vector', 'free', 'png', 'svg', 'wp', 'images', 'content', 'uploads']);
      if (preceding.length >= 3 && !genericPrefixes.has(preceding)) {
        return 'qualified';
      }
    }
    return 'leading';
  }
  return 'absent';
}

/**
 * Gate for accepting a DDG first-hit as the AUTO-default icon.
 * Rejects irrelevant stock art for obscure brands by requiring the brand token
 * to appear as a whole word/token in the candidate's title, image URL, or
 * source page URL. Uses word-boundary matching (not substring) so "dela" does
 * not match "takiedela".
 *
 * H1 extension: for candidates whose relevance comes only from domain affinity
 * (image/source host shares the bookmark's registrable domain), the image must
 * also carry a brand signal (brand in filename, or a logo/icon/favicon path).
 * A same-domain image with a FOREIGN brand in its filename (e.g. Rabobank-Logo
 * on twinq.nl) is rejected. A same-domain image with no brand/logo signal
 * (staff photo, screenshot) is also rejected.
 *
 * Returns true (accept) when:
 *  - Brand token is too short (< 3 chars) to match reliably — skip the gate.
 *  - Brand token appears as a word-boundary-delimited token in the candidate's
 *    label, imageUrl, or sourcePageUrl, AND the same-domain image gate passes.
 *
 * Returns false (reject) when:
 *  - Brand token (3+ chars) does not appear as a whole token anywhere.
 *  - Candidate is same-domain but image depicts a foreign brand or has no
 *    brand/logo signal.
 */
export function isDdgFirstHitRelevant(
  candidate: Pick<IconSearchCandidate, 'label' | 'imageUrl' | 'sourcePageUrl'>,
  bookmarkUrl: string,
): boolean {
  const { brand: rawBrand } = extractBrandInfo(bookmarkUrl);
  const brand = stripKnownVanityPrefix(rawBrand);
  // Short brands (< 3 chars) produce too many false positives — skip the gate.
  if (brand.length < 3) return true;

  const label = candidate.label ?? '';
  const imageUrl = candidate.imageUrl ?? '';
  const sourcePageUrl = candidate.sourcePageUrl ?? '';

  const hasBrandInMetadata = brandMatchesAsToken(brand, label)
    || brandMatchesAsToken(brand, imageUrl)
    || brandMatchesAsToken(brand, sourcePageUrl);

  if (!hasBrandInMetadata) return false;

  // People-content gate: image filenames that indicate photos of people
  // (founders, team, staff, testimonials) are never auto-resolution candidates.
  if (isPeopleContentImage(imageUrl)) return false;

  // --- H1 gate: same-domain image content check ---
  // When the brand token is found ONLY in the source/page host (domain affinity)
  // but NOT in the label text itself (independent of URL), verify the image
  // carries brand or logo signals. This catches partner logos and staff photos
  // on the brand's own site.
  const imageHostname = extractHostname(imageUrl);
  const sourceHostname = extractHostname(sourcePageUrl);
  const bookmarkRegistrable = getRegistrableDomain(
    extractHostname(bookmarkUrl),
  );

  const isSameDomainSource = Boolean(
    bookmarkRegistrable
    && sourceHostname
    && getRegistrableDomain(sourceHostname) === bookmarkRegistrable,
  );
  const imageRegistrable = getRegistrableDomain(imageHostname);
  const isSameDomainImage = Boolean(
    bookmarkRegistrable
    && imageHostname
    && imageRegistrable === bookmarkRegistrable,
  );

  // Cross-TLD same-brand detection: when the image host has a different TLD
  // but the same root label (e.g. ing.nl vs ing.com → root label "ing"),
  // treat it as same-brand. Only fires when root label is >= 3 chars to avoid
  // trivial collisions (e.g. "go.com" vs "go.nl").
  const bookmarkRootLabel = getRootLabel(bookmarkRegistrable);
  const imageRootLabel = getRootLabel(imageRegistrable);
  const isCrossTldSameBrand = Boolean(
    !isSameDomainImage
    && bookmarkRootLabel
    && imageRootLabel
    && bookmarkRootLabel.length >= 3
    && bookmarkRootLabel === imageRootLabel,
  );

  // H1 gate: same-domain vs off-domain scoping for foreign-brand rejection.
  //
  // SAME-DOMAIN images: the brand controls this origin, so a product/variant
  // name adjacent to "logo" (e.g. "widget-logo.png") is NOT a foreign brand.
  // Suppress detectForeignBrandInImage — but still require a positive logo
  // signal via sameDomainImageHasLogoSignal to accept (don't blanket-accept).
  //
  // CROSS-TLD same-brand (e.g. delta.nl image for delta.com bookmark):
  // suppress foreign-brand rejection (same brand, different TLD) but do NOT
  // grant the relaxed same-domain acceptance paths. A cross-TLD candidate
  // must pass on its own merits (brand in metadata already verified above).
  //
  // OFF-DOMAIN images: apply detectForeignBrandInImage at full strength —
  // a foreign brand token next to "logo" in an off-domain filename is a
  // genuine competitor logo and must be rejected.
  if (isSameDomainImage) {
    // Same-domain: skip foreign-brand check (brand owns the origin) but
    // require a logo signal to weed out staff photos, screenshots, and
    // content images that happen to live on the brand's own infrastructure.
    if (!sameDomainImageHasLogoSignal(imageUrl, brand)) return false;
  } else if (isCrossTldSameBrand) {
    // Cross-TLD sibling (e.g. assets.ing.com for bookmark mijn.ing.nl):
    // suppress foreign-brand rejection (same brand, different TLD) but
    // still require a positive logo signal — a cross-TLD candidate must
    // clear the same logo-signal bar as same-domain images.
    if (!sameDomainImageHasLogoSignal(imageUrl, brand)) return false;
  } else if (isSameDomainSource && !isSameDomainImage) {
    // Source page is on the brand's domain, image is elsewhere — apply
    // foreign-brand rejection at full strength on the off-domain image.
    const foreignBrand = detectForeignBrandInImage(imageUrl, brand);
    if (foreignBrand) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Shape pre-ranking for auto-selection (FIX 1)
//
// Nudges roughly-SQUARE candidates ahead of wide/tall ones WITHOUT letting
// shape override a significantly higher relevance score. The input is already
// sorted by relevance (scoreDuckDuckGoResult descending); shape acts as a
// bounded tiebreaker. A square candidate can surface above a wide candidate
// when they are separated by up to 2 * SHAPE_NUDGE_POSITIONS - 1 = 3
// positions (the square's nudge is 0, the wide's is 2 * NUDGE = 4, so the
// wide's effective key exceeds the square's when originalIndex gap <= 3).
// At a gap of 2 * SHAPE_NUDGE_POSITIONS = 4+ positions, relevance wins.
// ---------------------------------------------------------------------------

const SHAPE_SQUARE_THRESHOLD = 1.4;

/** 0 = square, 1 = neutral (unknown dims), 2 = wide/tall. */
function shapeRank(candidate: Pick<IconSearchCandidate, 'width' | 'height'>): number {
  const { width, height } = candidate;
  if (width == null || height == null || width === 0 || height === 0) return 1; // neutral
  const aspect = Math.max(width, height) / Math.min(width, height);
  return aspect <= SHAPE_SQUARE_THRESHOLD ? 0 : 2; // square: 0, wide/tall: 2
}

/**
 * Stable-sort candidates with shape as a bounded tiebreaker. Each candidate's
 * sort key is `originalIndex + shapeNudge`, where shapeNudge is 0 for square,
 * SHAPE_NUDGE_POSITIONS for neutral, and 2*SHAPE_NUDGE_POSITIONS for wide.
 * This lets a square candidate move up by at most SHAPE_NUDGE_POSITIONS places
 * but never leapfrog a candidate many positions higher in relevance.
 *
 * Used only in the auto path (fetchDuckDuckGoFirstHit).
 */
export function rankCandidatesByShape<T extends Pick<IconSearchCandidate, 'width' | 'height'>>(
  candidates: readonly T[],
): T[] {
  // A nudge of 2 means a square (nudge 0) can surface above a wide (nudge 4)
  // when they are up to 3 positions apart. At 4+ positions, relevance wins.
  const SHAPE_NUDGE_POSITIONS = 2;
  return candidates
    .map((c, i) => ({ c, key: i + shapeRank(c) * SHAPE_NUDGE_POSITIONS, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map(({ c }) => c);
}

// ---------------------------------------------------------------------------
// Hard-junk predicate for DDG fallback path
//
// Returns true ONLY for candidates that are genuinely wrong and should produce
// a letter-tile rather than being used as an icon. Two classes:
//   (1) People-content images (team photos, headshots, founders)
//   (2) Off-domain foreign-brand logos (competitor logo on a different domain,
//       not same-domain and not cross-TLD same-brand)
//
// Soft signals (missing brand token, low relevance, same-domain content images
// without logo signal) are NOT hard junk — the fallback path rescues those.
// ---------------------------------------------------------------------------

export function isHardJunkCandidate(
  candidate: Pick<IconSearchCandidate, 'imageUrl' | 'sourcePageUrl'>,
  bookmarkUrl: string,
): boolean {
  const imageUrl = candidate.imageUrl ?? '';

  // (1) People-content: always hard junk regardless of domain relationship
  if (isPeopleContentImage(imageUrl)) return true;

  // (2) Off-domain foreign-brand: only when the image is NOT on the bookmark's
  // own domain and NOT a cross-TLD sibling of the same brand.
  const { brand: rawBrand } = extractBrandInfo(bookmarkUrl);
  const brand = stripKnownVanityPrefix(rawBrand);
  // Short brands can't be reliably detected — skip foreign-brand check
  if (brand.length < 3) return false;

  const imageHostname = extractHostname(imageUrl);
  const bookmarkRegistrable = getRegistrableDomain(extractHostname(bookmarkUrl));

  // Same-domain: brand controls this origin, not hard junk
  const imageRegistrable = getRegistrableDomain(imageHostname);
  const isSameDomain = Boolean(
    bookmarkRegistrable
    && imageHostname
    && imageRegistrable === bookmarkRegistrable,
  );
  if (isSameDomain) return false;

  // Cross-TLD same-brand (e.g. ing.com image for ing.nl bookmark): not hard junk
  const bookmarkRootLabel = getRootLabel(bookmarkRegistrable);
  const imageRootLabel = getRootLabel(imageRegistrable);
  const isCrossTldSameBrand = Boolean(
    bookmarkRootLabel
    && imageRootLabel
    && bookmarkRootLabel.length >= 3
    && bookmarkRootLabel === imageRootLabel,
  );
  if (isCrossTldSameBrand) return false;

  // Off-domain: check for foreign brand adjacent to "logo" in the filename
  const foreignBrand = detectForeignBrandInImage(imageUrl, brand);
  if (foreignBrand) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Fallback candidate selection for DDG auto-resolution
//
// When isDdgFirstHitRelevant rejects ALL candidates (strict gate empties),
// this function selects the best non-hard-junk candidate. Filters out hard
// junk, ranks by relevance (scoreDuckDuckGoResult) then shape tiebreaker
// (rankCandidatesByShape). Returns an ordered list; the caller iterates it,
// calling fetchAndValidateImage on each until one validates.
// ---------------------------------------------------------------------------

export function selectBestSafeFallback(
  candidates: readonly IconSearchCandidate[],
  bookmarkUrl: string,
): IconSearchCandidate[] {
  if (candidates.length === 0) return [];

  // Filter out hard junk
  const safe = candidates.filter(c => !isHardJunkCandidate(c, bookmarkUrl));
  if (safe.length === 0) return [];

  // Rank by relevance score (descending), then shape tiebreaker
  const hostname = extractHostname(bookmarkUrl);
  const { brand: rawBrand } = extractBrandInfo(bookmarkUrl);
  const queryTerms = tokenizeQuery(rawBrand);
  const { isPersonalInfra } = extractBrandInfo(bookmarkUrl);
  const bookmarkHostname = isPersonalInfra ? null : hostname;

  const scored = safe
    .map(c => ({
      candidate: c,
      score: scoreDuckDuckGoResult(
        {
          image: c.imageUrl,
          thumbnail: c.previewUrl ?? c.imageUrl,
          title: c.label ?? '',
          url: c.sourcePageUrl ?? '',
          width: c.width ?? 0,
          height: c.height ?? 0,
        },
        bookmarkHostname ?? null,
        queryTerms,
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const sortedCandidates = scored.map(({ candidate }) => candidate);

  // Apply shape tiebreaker (bounded — does not override large relevance gaps)
  return rankCandidatesByShape(sortedCandidates);
}
