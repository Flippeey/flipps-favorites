# Project Structure

```
newtab.html                       # SPA entry HTML — mounts <div id="app">
src/
├── background/
│   ├── service-worker.ts         # MV3 background; message router; install/update lifecycle
│   └── icons/                    # Icon resolution + caching pipeline
│       ├── icon-service.ts       # resolveAutomaticIcon orchestration + cache/dedup
│       ├── icon-providers.ts     # Origin scrape, Google S2, Icon Horse, DuckDuckGo sources
│       ├── icon-parse.ts         # Parse <link rel> icons + web-app manifest from HTML
│       ├── icon-classify.ts      # Score / rank candidate icons
│       ├── icon-image.ts         # Fetch + decode + size image bytes
│       ├── icon-constants.ts     # Timeouts, TTLs, personal-infra host rules
│       ├── concurrency.ts        # ResolutionSemaphore + in-flight dedup
│       └── cors-bypass.ts        # Cross-origin fetch helpers
├── newtab/
│   ├── main.tsx                  # createRoot bootstrap; preloads settings + tree
│   ├── App.tsx                   # Root component; owns all top-level state
│   ├── components/               # All React components (.tsx)
│   │   ├── Tile.tsx              # BookmarkTile, FolderTile, TileFor, SectionHeader
│   │   ├── views.tsx             # SectionsView, TilesView, FolderPageView
│   │   ├── settings.tsx          # SettingsDrawer shell
│   │   ├── settings/            # Per-section drawer panels
│   │   │   ├── AppearanceSection.tsx, LayoutSection.tsx, ClockSection.tsx
│   │   │   ├── DockSection.tsx, NavigationSection.tsx, BackupSection.tsx
│   │   │   ├── HelpSection.tsx, types.ts, index.ts
│   │   ├── settings-controls.tsx # Shared form controls (toggle, segmented, etc.)
│   │   ├── ContextMenu.tsx, Dock.tsx, EditDialog.tsx
│   │   ├── FolderNameDialog.tsx, FolderOverlay.tsx, FolderMultiPicker.tsx
│   │   ├── HeroSearch.tsx, ModalDialog.tsx, Onboarding.tsx
│   │   ├── QuickAddDialog.tsx, TopNav.tsx, ToastHost.tsx
│   │   ├── Favicon.tsx, Ico.tsx, TemplatePicker.tsx
│   │   ├── NewWorkspaceDialog.tsx, WorkspaceLifecycleDialogs.tsx, ConfirmDeleteDialog.tsx
│   ├── state/                    # State-owning hooks consumed by App.tsx
│   │   ├── useOptimisticPatch.ts # runOptimistic helper for optimistic writes
│   │   ├── useSelection.ts       # Selection model (ids + scopeFolderId)
│   │   ├── useWorkspaceActions.ts # Workspace create/switch/delete/reorder
│   │   ├── useContextMenuBuilder.ts # Builds context-menu item lists
│   │   └── useToasts.ts          # Toast queue state (paired with ToastHost)
│   ├── interaction/              # Pointer + keyboard interaction hooks
│   │   ├── useDrag.ts            # Drag-drop with DropTarget union
│   │   ├── useDragWiring.ts      # Wires useDrag into App surfaces/refs
│   │   ├── useMarquee.ts         # Rubber-band selection
│   │   ├── useKeyboardNav.ts     # Arrow-key tile focus navigation
│   │   ├── useFocusTrap.ts       # Focus trap for dialogs/drawer
│   │   ├── useQuickAddShortcuts.ts # Quick-add keyboard shortcuts
│   │   ├── useWorkspaceShortcut.ts # Workspace switch shortcut
│   │   └── useEscapeKey.ts
│   ├── lib/                      # Non-component utilities
│   │   ├── messaging.ts          # All extensionApi.runtime.sendMessage wrappers
│   │   ├── tree.ts               # findNode, findFolder, isFolder, sortChildren, resolveRootFolder
│   │   ├── tree-profile.ts       # profileTree(): O(n) structural signals (bookmarks, folderedRatio, duplicateUrlRate, etc.)
│   │   ├── archetype-match.ts    # classify(): 3-class structural classifier (hoarder, power-user, casual) + temporal/split overlays
│   │   ├── url.ts                # Shared URL parsing/normalization + canonicalUrlForDedup()
│   │   ├── accent.ts             # applyAccent, applyDensity, resolveThemeAttr
│   │   ├── dock-mode.ts          # resolveDockMode (shared by App + DockSection)
│   │   ├── folder-scoring.ts     # Score folders for quick-add target matching; exports SYSTEM_FOLDER_IDS
│   │   ├── icon-helpers.ts, icon-prefetch.ts, favicon-cache.ts
│   │   ├── useBlobUrl.ts         # Hook for blob URL lifecycle management
│   │   ├── platform.ts           # IS_MAC, MOD_KEY, ALT_KEY, modShortcut, altShortcut
│   │   └── workspace-transfer.ts # Workspace import/export (WORKSPACE_SCHEMA_VERSION 2)
│   └── styles/                   # tokens.css + index.css + feature files
│       ├── index.css             # Import chain (load order matters)
│       ├── tokens.css            # Design tokens
│       ├── base.css              # Root vars, body, app shell, bg, theme
│       ├── nav.css               # Top nav, breadcrumbs, pills, context menu
│       ├── hero.css              # Hero, search bar, search results
│       ├── tiles.css             # Canvas, grid, tiles, folder tile, sections, empty
│       ├── overlay.css           # Folder overlay dialog
│       ├── dock.css              # Bottom dock
│       ├── dialogs.css           # Modal scrim + shared dialog chrome
│       ├── settings-drawer.css   # Settings drawer + its controls
│       ├── onboarding.css        # Onboarding flow
│       ├── interactions.css     # Marquee, drag-drop, toggle/segmented, status
│       └── responsive.css        # Media-query overrides (last in cascade)
└── shared/                       # Cross-context code (background ↔ newtab)
    ├── messages.ts               # SOURCE OF TRUTH: message types + contracts
    ├── models.ts                 # Shared data models (bookmarks, workspaces, settings)
    ├── browser.ts                # extensionApi shim (browser || chrome)
    ├── storage.ts                # Typed read/write of settings, icon cache, usage; OnboardingState v2
    ├── storage-buckets.ts        # CachedValueStore / CachedRecordStore generics
    ├── icon-idb.ts               # IndexedDB store for icon blobs
    ├── icon-fallback.ts          # Generated letter-tile fallback icon
    ├── seed-data.ts              # First-run seed bookmarks
    ├── constants.ts              # MAX_WORKSPACES = 20, other shared constants
    ├── organization-templates.ts # ORGANIZATION_TEMPLATES: 4 archetype bundles + per-workspace view/sort overrides
    ├── url-brand.ts              # extractBrandInfo, getBrandName for favicon titling
    └── globals.d.ts              # Ambient browser/chrome declarations
tests/
├── global-setup.ts               # Asserts dist/{chrome,firefox} exist (does NOT build — run build first)
├── fixtures/                     # extension-context, world, seeding, selectors, bookmark-helpers, test-data
├── specs/                        # *.spec.ts — Playwright user-flow coverage (one file per area)
└── unit/                         # *.test.ts — Vitest unit tests mirrored to src layout
scripts/
├── write-manifest.mjs            # Post-build manifest generator
└── promo/                        # Promo asset generation (index, screenshots, videos, to-gif, to-mp4, lib)
```

## Key File Index

| File | Purpose |
|------|---------|
| `src/shared/messages.ts` | Message contracts + types. Check here first when adding cross-context features. |
| `src/shared/models.ts` | Shared data models used across both contexts. |
| `src/shared/organization-templates.ts` | Template bundles: per-archetype view/sort overrides. |
| `src/newtab/App.tsx` | Top-level state orchestration; composes the `state/` hooks + dialogs/drawers |
| `src/newtab/state/` | State-owning hooks (selection, workspaces, toasts, optimistic patch, context menu) |
| `src/newtab/main.tsx` | App bootstrap (preloads settings + tree, then renders `<App>`) |
| `src/newtab/lib/tree-profile.ts` | profileTree: O(n) structural metrics (totalBookmarks, folderedRatio, domainDiversity, etc.). |
| `src/newtab/lib/archetype-match.ts` | classify: 3-class archetype matcher (hoarder, power-user, casual) w/ overlays. |
| `src/newtab/components/TemplatePicker.tsx` | Onboarding template picker; 4 equal cards, classifier preselects. |
| `src/background/service-worker.ts` | Message router + extension lifecycle |
| `src/background/icons/icon-service.ts` | Icon resolution pipeline entry (`resolveAutomaticIcon`) |
| `src/newtab/lib/messaging.ts` | Typed wrappers around `runtime.sendMessage` |
| `src/shared/storage.ts` | Settings/icon-cache/usage persistence; OnboardingState v2 migration. |
| `vite.config.mjs` | Build config (dual output) + `@` → `src` alias |
| `tsconfig.json` | Strict TS config + `@/*` path mapping |
| `scripts/write-manifest.mjs` | Manifest generation with env var overrides |
| `playwright.config.ts` | Test runner config (chrome + firefox projects) |
