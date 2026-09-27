# Changelog

All notable changes to Flipp's Favorites are documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.7.0] — Folder pickers, undo, and search fallback

### Added
- **Destination folder picker** in the add-bookmark and add-folder dialogs — choose where a new item lands without leaving the dialog.
- **Move to...** and **Open all in tabs** context-menu actions for folders.
- **Undo** toast for folder delete and batch delete.
- **QuickAdd duplicate-bookmark hint** — warns when the URL you're adding is already bookmarked.
- Hero search opens a typed URL directly, or falls back to a web search when there are zero matches.
- Opt-in custom icons for folders.

### Fixed
- Wallpaper opacity at 100% no longer leaves a dark tint over the background.
- Firefox new-tab page now shows the correct branded favicon instead of a generic one.
- Drag-selector ids are now escaped before use in attribute selectors, preventing a drag from aborting mid-drag on ids containing special characters.
- Firefox XHR redirect URL is threaded through correctly so the origin-scrape login-redirect guard fires as intended.
- Settings that fail to persist now surface a toast instead of failing silently.
- Workspace import is capped and embedded data-URL icons are size-bounded, preventing oversized imports from corrupting storage.
- Workspace and icon-cache record writes are now serialized, so concurrent writes can no longer drop each other's changes.

## [2.6.2] — Firefox stability + E2E coverage

### Fixed
- Firefox new-tab page opening correctly again (regression from the 2.6.1 Firefox icon-loading fix).
- Firefox icon loading and the DDG icon-search picker further hardened.

### Added
- Firefox end-to-end test coverage via a Puppeteer + WebDriver BiDi suite.

## [2.6.1] — Firefox icon loading restored

### Fixed

- **Firefox icon loading** — icons now load correctly on Firefox. Switches to XMLHttpRequest via a background page so that host_permissions CORS bypass is honoured (Firefox service workers do not get this bypass, causing all icon sources to fail in 2.6.0).
- **Firefox DDG icon-search picker** — thumbnail images in the Edit Icon dialog now render on Firefox. The edit dialog sets `referrerPolicy="origin"` on Firefox, matching the XHR referrer policy used for icon search requests.
- **Firefox host permissions** — removed redundant explicit entries (`duckduckgo.com`, `icon.horse`) from the Firefox manifest; the `https://*/*` wildcard already covers them via XHR.

## [2.6.0] — Per-workspace view/sort, organization templates, 20 workspaces

### Added
- Per-workspace view mode and sort order, with a Sort control surfaced in the Layout settings.
- Organization-template onboarding: the wizard recommends a persona-based template (Hoarder, Power User, Casual, and overlays) and applies matching view/sort defaults.
- Workspace cap raised from 9 to 20, with Alt+Arrow shortcuts and a desktop jump-menu for switching.
- "Create workspace" option on the folder context menu, and drag a folder onto the workspace tab bar to create one directly.
- Icon search result source shown in the hover title.
- Middle-click a bookmark tile to open it in a new tab.
- Bookmark icons prefetch during bootstrap, removing the placeholder-icon flash on load.
- RELEASE_NOTES.txt wired into the AMO publish workflow.

### Fixed
- Archetype classifier scoring and giant-folder share calculation corrected.
- Density picker no longer recommends Presentation layout above ultrawide breakpoints.
- Default "Favorites" workspace is created when onboarding is skipped.
- Sync storage quota overflow at the 20-workspace cap resolved by moving to per-workspace sync keys.
- Origin-scrape icon lookups no longer retry every probe against hosts that downgrade `https://` to `http://`, which was flooding the console.
- "Remember last workspace" toggle is honored on boot.
- Drag-source state no longer sticks across workspace switches, which was muting favicons.
- Undo toast now also covers cross-folder moves made in list view.
- DDG icon auto-resolution relevance improved; IDN punycode domains decode correctly for the brand query; Icon Horse letter-placeholders are gated so they fall through to DDG instead of poisoning the cache.

### Changed
- Gradient background picker simplified to accent color plus custom chips.
- Workspace settings drawer restyled with skeleton-preview cards and consistent headers.

## [2.4.1] — Undo, drag relocation, and auto-accent

### Added
- Undo toast for bookmark and folder relocations.
- Move selected bookmarks into a new folder directly from the context menu.
- Double-click an icon search result to apply it and close the dialog.
- New workspaces auto-assign a distinct accent color at creation.
- Onboarding picks a resolution-aware default layout for new installs.
- Chrome Web Store + AMO publish workflow.

### Fixed
- Drag-and-drop relocation now works under auto-sort modes, not just manual sort.
- Drop indicator and drag handle confinement fixed for folder-to-root relocation and list view.

## [2.4.0] — Scoped icon overrides, deep folder picker

### Added
- Icon overrides are now scoped (exact URL, host, or domain), with a host-keyed cache, a login-redirect guard, and SVG/ICO icon support.
- Deep expand/collapse folder picker for workspace creation, with recommendations merged into one capped, pinned list.
- Accent color handling is theme-aware.

### Fixed
- Icon search seeds its query with a subdomain-aware brand name.
- Folder picker no longer double-scrolls; sized to match the onboarding and new-workspace dialogs.
- Hero/nav no longer flickers when collapsing at small viewport widths.
- Firefox now shows the dashboard on startup via a homepage override.

## [2.3.3] — Per-workspace theming, IndexedDB icon storage

### Added
- Per-workspace theme mode (light/dark independent of the global setting).
- Tips carousel in onboarding.
- Bookmark folder view modes.
- Privacy policy document.

### Changed
- Icon cache and overrides moved from `chrome.storage` to IndexedDB.
- Drag-and-drop visual indicators enhanced for section headers.

### Fixed
- Active workspace tab legibility on dark theme with a wallpaper background.
- Clock text shadow strengthened against wallpaper backgrounds in dark mode.
- Search overlay now shows when the hero search bar is scrolled off-screen.
- Onboarding workspace theme preview updates live as you pick a theme in step 2.
- Workspace creation is skipped when the target root folder already exists.
- Marquee selection pointer handling hardened.
- Legacy storage quota freed on update; expired IndexedDB icon records evicted on sweep.

## [2.2.0] — Polish & shortcuts

### Added
- Context menu and keyboard shortcuts for folder and workspace management inside the folder overlay.

### Changed
- Refined onboarding steps and workspace settings handling during first-run setup.
- Hover styles for icon buttons and navigation pills in the light theme.
- Updated navigation button styling for a cleaner look.

### Fixed
- Bookmark URL normalization improvements (more reliable matching, fewer duplicates).

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

## [< 2.0.0] - Prior changelogs have been omitted because they are no longer relevant.