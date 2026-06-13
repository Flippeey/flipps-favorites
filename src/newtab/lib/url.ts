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
