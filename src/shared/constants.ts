export const MAX_WORKSPACES = 9;

// Schemes a bookmark URL may use. http/https plus browser-internal pages and
// local files. Note: chrome://, edge://, about: bookmarks save + display, but
// an extension page is blocked from opening them via window.open on click.
export const ALLOWED_BOOKMARK_SCHEMES = ['http:', 'https:', 'chrome:', 'edge:', 'about:', 'file:'] as const;
