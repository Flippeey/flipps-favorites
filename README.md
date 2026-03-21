# Flipp's Favorites - Bookmarks & more

Flipp's Favorites is a cross-browser new tab extension focused on one thing: helping you get to what matters faster.

Instead of opening a blank page or a noisy dashboard, each new tab becomes a focused workspace for your bookmarks, folders, and frequently used sites, with flexible visuals and a lightweight settings experience.

## Project Vision

This extension is designed around two practical principles:

1. Productivity first
- Fast access to bookmarks and folders from every new tab.
- Visual cues and customizable layout so you can scan and launch quickly.
- Settings that are easy to reach and easy to understand.

2. Least-privilege by default
- Keep required permissions to the minimum needed for the feature set.
- Avoid adding sensitive permissions unless a feature clearly justifies them.
- Prefer local-first storage and explicit user actions over hidden background behavior.


## What You Can Do

- Replace the browser new tab page with a bookmark-focused dashboard.
- Navigate bookmark folders directly in-page.
- Use visual bookmark tiles and custom icon overrides.
- Personalize the experience with themes, wallpaper, and accent color options.
- Manage behavior and appearance from a settings drawer.
- Import/export workspace settings and icon overrides to move setups between devices.

## Productivity Benefits

- Reduced context switching: your most-used links are available the moment a tab opens.
- Faster launch patterns: visual tiles and folder navigation reduce click depth.
- Stable personal workflow: appearance and layout settings help keep navigation predictable.
- Better continuity across devices: import/export gives you controlled portability without requiring aggressive sync.

## Permission Strategy

The extension follows a "minimum necessary" permission model.

Current baseline permissions:
- `bookmarks`: required to read and organize bookmark content in the dashboard.
- `storage`: required to persist settings, UI preferences, and local icon overrides.

Current host permissions:
- `https://*/*` by default.
- Optional `http://*/*` when explicitly enabled at build time.

Host permission scope is intentionally constrained to support web icon and related URL-backed visual workflows. Additional permissions are evaluated feature-by-feature and are not added preemptively.

## Privacy and Data Handling

- No required account or sign-in flow.
- Settings and icon overrides are stored in extension storage.
- Custom icon overrides are intentionally local-first to avoid sync quota issues.
- Transfer between devices is handled with explicit import/export actions.

## Clean-Room Rewrite Boundaries

This project is intentionally rebuilt from scratch to reduce maintenance risk and support long-term evolution.

- Legacy codebases are used for behavior reference only.
- Protected implementation details and bundled assets are not reused.
- New architecture, UI structure, and content are authored for this rewrite.

## Tech Stack

- TypeScript
- Vite
- Manifest V3 extension architecture
- Shared message contracts between UI and background

## Development

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Create production builds for both Chrome and Firefox:

```bash
npm run build
```

Individual targets:

```bash
npm run build:chrome
npm run build:firefox
```

Type-check only:

```bash
npm run typecheck
```

## Configuration Notes

`scripts/write-manifest.mjs` supports environment overrides for build-time metadata (for example version, Firefox ID/update URL, and host permission behavior).

Example: include `http://*/*` host permissions in a build:

```bash
INCLUDE_HTTP_HOSTS=1 npm run build:chrome
```

## Roadmap Direction

Near-term work continues to prioritize:

- Faster interaction loops in the new tab UI.
- Strong modular boundaries between background and page code.
- Permission reductions wherever features allow.
- Better long-term maintainability for Chrome and Firefox parity.

For architecture details and phased implementation planning, see `docs/rewrite-plan.md`.
