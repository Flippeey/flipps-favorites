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

## [< 2.0.0] - Prior changelogs have been omitted because they are no longer relevant.