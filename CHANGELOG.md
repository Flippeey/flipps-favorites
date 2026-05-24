# Changelog

All notable changes to Flipp's Favorites are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-release notes (with the exact wording used in store listings) live under [`releases/<version>/CHANGELOG.md`](./releases). This file is the consolidated history.

## [Unreleased]

## [2.1.0] — Workspaces

### Added
- **Workspaces** — multiple per-context dashboards in a single extension. Each workspace keeps its own theme, accent, wallpaper, layout, and dock.
- Workspace tabs in the top nav for one-click switching.
- Settings drawer split into **Global** and **Workspace** scope tabs.
- Add, rename, duplicate, and delete workspaces from the top nav or workspace settings drawer.
- Drag-and-drop reordering of workspace tabs.
- Drag bookmarks onto a workspace tab to move them across workspaces.
- Onboarding scans the existing bookmark tree and recommends workspace groupings (with a manual folder picker as fallback).
- **Batch delete** for multiple bookmarks via marquee or Ctrl/Cmd+click, with a confirmation dialog.
- Tile focus state for keyboard navigation.
- Refreshed icon set throughout the UI.
- Improved keyboard shortcuts across the new tab page.

### Changed
- Settings drawer navigation reorganised; footer styles added.
- Light theme refinements for workspace tabs and settings drawer.
- Marquee selection now works inside scrollable containers (folder overlay, etc.).

### Removed
- Non-functional "Rename" option from the context menu.

### Fixed
- Saved workspace order was silently dropped on settings reload (`workspaceOrder` missing from `normalizeSettings`) — tabs now persist their reordered position.
- Guard against dropping a workspace tab onto itself.
- Stale closure in the delete-workspace handler.
- Several hardening fixes around workspace CRUD messaging.

## [2.0.3] — Improved icon loading

### Changed
- Favicon pipeline rewritten for more reliable and consistent icon resolution across site types.
- Fewer redundant network requests and faster icon loading.
- Removed unused prefetch logic.

## [2.0.2] — Onboarding + search fixes

### Fixed
- Onboarding flow now shows on fresh install.
- Search now covers the entire bookmark library, including dock-shortcut folders (previously limited to the active root folder).

### Changed
- New installs default to a top-gradient background style for a cleaner look.

## [2.0.1] — Pipeline alignment

Patch release. No functional changes — version bump only to align the build pipeline and distribution metadata.

## [2.0.0] — Full rewrite

A ground-up rewrite of the new tab page.

### Added
- Redesigned tiles, sections, folders, and dock.
- Full background customisation: solid colour, gradient (with style + intensity), or custom wallpaper image.
- Wallpaper opacity, fit, and position controls.
- Accent colour, theme, density, and tile-shape controls in a unified settings drawer.
- Folder CRUD directly from the page (no browser bookmark manager required), with confirmation before delete.
- Sections view groups folders into rows; classic tiles view still available.
- Folder overlay opens any folder in a quick popup.
- Workspace import/export for backup or moving between machines.
- Smart icon resolution chain (site → Icon Horse → standard favicon services) with 30-day cache and stale-refresh sweep.
- Built-in icon search; paste-image-URL override; icon edit dialog reports which source the icon came from.
- Drag-and-drop everywhere: reorder, drop into folders, drop into the dock, drop onto breadcrumbs to move up, marquee-select and drag groups, dock reorder with accent landing marker.
- Right-click menu available across the whole page (including edges); new "Settings" shortcut; dock items get a full context menu; folder section headers get a menu button.

### Changed
- Migrated to React 19 with a strict, type-safe architecture.
- Faster, smaller bundle thanks to dead-code cleanup and consolidated styles.
- Cross-browser parity — every change ships to Chrome and Firefox in lockstep.

### Removed
- Redundant "Home" button from the top nav.
- Redundant "+" button from the dock (use the top-nav plus or right-click empty dock space).

### Fixed
- Sort dropdown no longer briefly anchors on the wrong side when opening.

### Tests
- Brand-new Playwright suite covering bookmarks, icons, navigation, search, settings, and theme.

## [1.2.2] — Housekeeping

### Changed
- Cleaned up promo video files that were accidentally tracked in version control.
- Updated copyright attribution.

No extension functionality changes — safe upgrade from 1.2.1.

## [1.2.1] — Search + layout polish

### Added
- Search-bar customisation: choose preferred search engine and adjust appearance from settings.
- New layout options for tile arrangement and display.

### Changed
- Clock widget restyled for visual consistency (sizing + spacing).
- Settings drawer polish: cleaner section layouts, better spacing, more consistent option groupings.

### Fixed
- Miscellaneous localisation and storage-handling fixes.

## [1.2.0] — Clock + search bar settings

### Added
- Clock can be placed at **top center** or **bottom center** in addition to the four corners.
- New **X-Large** clock size for wall displays / high-resolution screens.
- Clock style cards and position picker now match the layout-preset visual language, with a corner-dot preview.
- Dedicated **Search** tab under General settings:
  - Show / hide the search bar entirely.
  - Search bar position (left, center, right).
  - "Limit search to current folder" toggle moved here from General.

### Fixed
- Clock overlay now floats at viewport level (same height as the search bar) — stays consistently placed regardless of scroll.
- Clock and position picker settings cards now render with proper background and border (missing CSS variables).
- "Show search bar" toggle now actually hides the search bar (CSS `display: flex` was overriding the HTML `hidden` attribute).

## [1.1.0] — Sort + i18n foundation

### Added
- Custom sort dropdown — choose bookmark order directly from the interface.
- Internationalisation translation layer (ready for future language support).

### Changed
- Updated new tab page title.

### Fixed
- Dragging bookmarks into folders sometimes didn't work correctly.
- Improved reliability of background service communication, especially around drag-and-drop.

## [1.0.1] — Empty-folder polish

### Added
- **"Add Bookmark"** button shown alongside **"Add Folder"** in empty folders.

### Fixed
- Empty-folder buttons ("Add Folder", "Open Bookmark Manager") were unresponsive due to a pointer-event conflict with the drag-and-drop selection layer.

### Changed
- Improved onboarding flow.
- README rewritten with cleaner structure and clearer installation instructions.
- Firefox: "Open Bookmark Manager" button hidden (Firefox does not allow extensions to open the native bookmark manager).

## [1.0.0] — First production release

### Added
- **Responsive layout**: below 720 px, settings slides up from the bottom, nav buttons become icon-only, breadcrumbs collapse, sort dropdown shrinks to an icon.
- **Sticky navbar** as you scroll through a large bookmark grid (matches the existing sticky search bar).
- **Hero search bar** just below the navbar to filter the current folder.
- **Accent in background** setting — blend the accent colour into the page background gradient.

### Changed
- Changing a setting no longer resets the settings-drawer scroll position.
- Drawer's responsive grid layouts collapse gracefully at narrow widths.
- Smarter bookmark-name extraction when searching for icons.
- Button borders, border-radii, and hover states consistent across the UI.
- Bookmark canvas gradient and tile hover effects refined.
- Context menu has a smooth entrance animation and corrected shadow.

### Fixed
- Placeholder / fallback bookmark icons no longer show a white corner bleed.
- Accent shadows on placeholder icons replaced with a neutral shadow during hover.
- Empty-state border-radius.
- Duplicate context-menu item-width rule.
- Colour-scheme inheritance that caused unexpected theme overrides.
- DuckDuckGo image-search fallback for icon resolution.
- Transparent fallback-icon backgrounds prevent SVG corner bleed at all sizes.

### Tech
- Dual-target build (Chrome MV3 + Firefox MV3) from a single source.
- Strict TypeScript throughout.
- Storage layer uses sync-preferred buckets with local fallback.

## [0.3.6] — Icon search refinements

### Changed
- Icon search now queries by the website's domain name (e.g. "pogdesign") instead of the bookmark's display title (e.g. "TV Calendar"). You can still type any custom term to override.
- Image search requests medium-sized, square-shaped images from DuckDuckGo (filter restored after a refactor).

### Fixed
- Clicking the Search button fired two identical requests at once. The duplicate handler is gone — one click, one request.

## [0.3.5] — DuckDuckGo CORS workaround (Firefox 140)

### Fixed
- Firefox 140 regression where `host_permissions` no longer applied the CORS bypass for background page requests. The extension now uses `declarativeNetRequest` to temporarily inject an `Access-Control-Allow-Origin` header on DuckDuckGo responses during search.

### Added
- `declarativeNetRequest` permission to support the workaround.

## [0.3.4] — Switched icon search to Wikimedia Commons

### Changed
- Icon search now uses the **Wikimedia Commons** media API instead of DuckDuckGo. Wikimedia explicitly supports cross-origin requests, removing the need for a CORS bypass entirely. Works in both Chrome and Firefox.

### Why
- v0.3.2 and v0.3.3 attempted CORS workarounds (`XMLHttpRequest`, background page instead of service worker). Firefox MV3 still refused to expose response bodies for third-party requests, so the underlying problem was unsolvable without changing data source.

## [0.3.3] — Firefox background as page

### Changed
- Firefox build now declares `background.page` instead of `background.scripts`, so the background runs in a full page context where `XMLHttpRequest` is available and applies the extension's host permissions.
- Chrome build unchanged (still uses a service worker with `fetch()`).

### Why
- Firefox 140 runs MV3 backgrounds as service workers, where `XMLHttpRequest` is unavailable.

## [0.3.2] — Firefox icon search via XHR

### Changed
- Icon search uses `XMLHttpRequest` when running in Firefox (correctly bypasses CORS where `fetch()` does not). Chrome continues to use `fetch()`.

### Fixed
- Firefox-installed XPI users can now retrieve image results from DuckDuckGo in the edit bookmark dialog.

## [0.3.1] — Icon search request fixes

### Fixed
- Initial DuckDuckGo request was using image-specific URL parameters that caused JS-only rendering, hiding the session token. Switched to the standard search URL where the token is embedded server-side.
- Added explicit DuckDuckGo host permission for Firefox.
- Expanded token-extraction patterns to cover more DuckDuckGo HTML formats.

## [0.3.0] — Icon search bug fix

### Fixed
- Removed an incorrect `X-Requested-With: XMLHttpRequest` header on the initial DuckDuckGo page load that triggered bot detection and stripped the session token from the response.
- Expanded session-token extraction patterns.
- Favicon now always appears in the icon-search results list alongside any DuckDuckGo results, guaranteeing at least one option regardless of search outcome.

## [0.2.0] — Initial public package

First packaged release. No CHANGELOG file was published for this version; see the release zip in [`releases/0.2.0/`](./releases/0.2.0/).
