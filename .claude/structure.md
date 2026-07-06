# Project Structure

Directory-level map — intentionally not per-file, to stay drift-free. Run `ls` or Glob for exact file lists; Key File Index below covers entry points.

```
newtab.html                       # SPA entry HTML — mounts <div id="app">

src/background/                   # MV3 background; message router; install/update lifecycle
  service-worker.ts              # Message dispatcher + lifecycle hooks
  icons/                          # Icon resolution, caching, image fetching

src/newtab/                       # React 19 SPA (new-tab page)
  main.tsx                        # App bootstrap (preload + mount)
  App.tsx                         # Root: owns all top-level state
  components/                     # React components
    settings/                     # Per-section settings panels
  state/                          # State-owning hooks: useSelection, useWorkspaceActions, useToasts, useContextMenuBuilder, useOptimisticPatch
  interaction/                    # Interaction hooks: useDrag, useDragWiring, useMarquee, useKeyboardNav, useFocusTrap, useQuickAddShortcuts, useWorkspaceShortcut, useEscapeKey
  lib/                            # Utilities (messaging, tree, classification, URL, accent, theming, dock-mode, folder-scoring, platform, workspace-transfer)
  styles/                         # Import chain in index.css (order matters); see root CLAUDE.md for chain

src/shared/                       # Cross-context code
  messages.ts                     # SOURCE OF TRUTH: message types + contracts
  models.ts, browser.ts, storage.ts, storage-buckets.ts, icon-idb.ts
  organization-templates.ts, icon-fallback.ts, seed-data.ts, constants.ts, url-brand.ts, globals.d.ts

tests/
  global-setup.ts                 # Asserts dist/{chrome,firefox} exist (does NOT build)
  fixtures/                       # Playwright fixtures (world, extension-context, seeding, selectors, helpers)
  specs/                          # Playwright E2E specs (one per user-flow area)
  unit/                           # Vitest unit tests (mirrored to src layout)
  firefox-e2e/                    # Puppeteer + WebDriver BiDi Firefox suite (separate global-setup, launch, seed, vitest config)

scripts/
  write-manifest.mjs              # Post-build manifest generator
  promo/                          # Promo asset generation (screenshots, videos, etc.)
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
