// Interim cap bounded by Chrome storage.sync's 8 KB-per-item limit: all
// workspaces are serialized into a single sync key, and ~12 typical records
// (each ~630 B) already hit 8 KB. 10 leaves headroom for long names so we never
// silently overflow sync. Raising this requires the per-workspace-key storage
// refactor (one sync item per workspace) — tracked as a separate task.
export const MAX_WORKSPACES = 10;

// Schemes a bookmark URL may use. http/https plus browser-internal pages and
// local files. Note: chrome://, edge://, about: bookmarks save + display, but
// an extension page is blocked from opening them via window.open on click.
export const ALLOWED_BOOKMARK_SCHEMES = ['http:', 'https:', 'chrome:', 'edge:', 'about:', 'file:'] as const;
