// URL helpers shared by bookmark add/edit/open paths. Single source of truth for
// how raw user input becomes a navigable URL — extend here, never fork.

// True when the value already carries a real URL scheme. The `(\/\/|[^0-9])`
// lookahead avoids misreading a bare "host:port" (e.g. "localhost:3000") as a
// scheme, so those still get https:// prepended.
export function hasUrlScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:(\/\/|[^0-9])/i.test(value);
}

// Ensure a bookmark URL has a scheme so window.open / navigation treats it as
// absolute. A value that already has a scheme (https://, chrome://, file://…)
// is returned untouched; a bare host gets https:// prepended.
export function normalizeBookmarkUrl(url: string): string {
  return hasUrlScheme(url) ? url : `https://${url}`;
}

// Result of classifying raw hero-search input as a navigable URL or a search query.
export type HeroInputClassification = { kind: 'url'; url: string } | { kind: 'search'; query: string };

// True only when `value` starts with an http/https scheme prefix AND parses to
// exactly that protocol via the URL constructor. This is the sole allow-list for
// kind:'url' below — do NOT substitute hasUrlScheme() here. hasUrlScheme() matches
// any scheme-shaped prefix (javascript:, data:, file:, chrome:, ...) and
// normalizeBookmarkUrl() passes those through untouched, so reusing it as the URL
// test would let disallowed schemes reach kind:'url' (XSS vector).
function isHttpOrHttpsUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Classify raw hero-search input: only explicit http(s) URLs navigate directly,
// everything else (bare hosts, host:port, dotted tokens, other schemes, free
// text) is routed to web search so the user's literal input is searched rather
// than silently auto-navigated or executed.
export function classifyHeroInput(value: string): HeroInputClassification {
  const trimmed = value.trim();
  if (isHttpOrHttpsUrl(trimmed)) {
    return { kind: 'url', url: trimmed };
  }
  return { kind: 'search', query: value };
}

// Canonical key used for duplicate-URL detection across a bookmark collection.
// Strips trailing slashes and normalises http → https so that
// "http://example.com/" and "https://example.com" map to the same key.
// Returns null for unparseable or non-http(s) URLs (e.g. chrome://, file://)
// so callers can skip those rather than treating every chrome:// page as a dup.
export function canonicalUrlForDedup(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Only deduplicate http and https bookmarks; leave special schemes alone.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  // Normalise to https, remove trailing slash from pathname, preserve rest.
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const search = parsed.search;
  const hash = parsed.hash;
  return `https://${parsed.host}${path}${search}${hash}`;
}
