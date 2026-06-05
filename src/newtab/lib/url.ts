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
