// Cap raised to 20 after the per-workspace-key storage refactor (each workspace
// now lives under its own sync key, e.g. `workspace:<id>`).
//
// Quota headroom (Chrome storage.sync limits):
//   Per-item:   8 192 B  — a typical WorkspaceRecord is ~630 B → well under limit
//   Total:    102 400 B  — 20 × 630 B ≈ 12 600 B → well under 100 KB
//   MAX_ITEMS:      512  — 20 workspace keys + ~10 other keys = ~30 → well under 512
//
// Write-rate limits (120/min, 1 800/hr): onboarding creates ≤ 20 workspaces in
// a single batch (20 sequential writes) and reorder ops write one record at a
// time, so normal usage stays far below either cap.
export const MAX_WORKSPACES = 20;

// Schemes a bookmark URL may use. http/https plus browser-internal pages and
// local files. Note: chrome://, edge://, about: bookmarks save + display, but
// an extension page is blocked from opening them via window.open on click.
export const ALLOWED_BOOKMARK_SCHEMES = ['http:', 'https:', 'chrome:', 'edge:', 'about:', 'file:'] as const;

// When true, icon prefetch fires immediately during bootstrap (before React
// mounts the grid) instead of deferring via requestIdleCallback.  This
// eliminates the letter-tile placeholder flash on cold start.  Set to false
// to revert to the deferred behaviour if startup-latency regressions appear.
export const EAGER_ICON_PREFETCH = true;
