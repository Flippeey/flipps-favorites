# Architecture Patterns

Patterns repeated across the codebase. Follow them when adding features.

## Message Pipeline (cross-context calls)

Newtab UI reaches browser APIs only through the service worker. Steps for any new cross-context call:

1. Add request + response type to `src/shared/messages.ts`.
2. Add `messageTypes.*` constant in the same file.
3. Add thin wrapper in `src/newtab/lib/messaging.ts`:
   ```typescript
   export async function getSettings(): Promise<AppSettings> {
     const res = await send<GetSettingsResponse>({ type: messageTypes.getSettings });
     return res.settings;
   }
   ```
4. Handle the type in `src/background/service-worker.ts`'s `handleMessage` switch.
5. Background returns the typed `AppResponse`.

For browser API access from background or shared code, import `extensionApi` from `src/shared/browser.ts`. Use the shim instead of raw `chrome.*` / `browser.*` so both targets keep working.

## State Ownership (App.tsx)

`App.tsx` owns ALL top-level state. Representative groups: **Data** (`settings`, `tree`, `usage`, `workspaces`); **UI state** (`openFolderId`, `contextMenu`, `selection`); **Dialog targets** (`editTarget`, `quickAddTarget`, `folderNameTarget`); **Surface refs** (element refs for interaction hooks); etc. See source for complete inventory.

Child components are presentational — they receive props and call back via `on*` handlers. If state is shared by multiple sibling components, lift to `App.tsx` rather than introducing context providers or a state library.

### Per-Workspace View & Sort

Each `WorkspaceRecord` stores `viewMode` and `sortMode` overrides (default: app-level `layoutPreset`/`sortMode`). Applied by `LayoutSection` when workspace-scoped setting is present. Onboarding templates set per-workspace view/sort via creation overrides, not app-level settings. Re-running templates over an existing workspace requires explicit user opt-in (no silent patch).

Bulkier state slices are factored into hooks under `src/newtab/state/` (see structure.md for full inventory). Add new state-owning logic as a `state/` hook consumed by App rather than growing `App.tsx` inline.

Optimistic update pattern (`handlePatch` in `App.tsx`):
```typescript
setSettings(prev => ({ ...prev, ...patch }));      // optimistic
try { setSettings(await patchSettings(patch)); }   // reconcile with truth
catch { /* keep optimistic value */ }
```

Refresh-after-mutation pattern: call `refreshTree()` in the `onSaved` / `finally` of the mutating operation.

## Interaction Hooks

`useDrag` and `useMarquee` take a `surface: HTMLElement | null` and a `selectionRef: RefObject<...>`. The owning component uses `setCanvasEl` / `setOverlayBodyEl` via ref callback so the hook re-binds when the element mounts. `useDragWiring` bundles the `useDrag` setup App needs; keyboard interactions are also hooked (see structure.md for full interaction-hook inventory).

When adding a new interaction hook: accept `surface` + refs, return a render-state object (e.g. `{ x, y, ids }` for drag preview, a rect for marquee), and let `App.tsx` route the result into JSX.

## CSS-Variable Theming

Theme, accent, density, tile shape, dock mode all flow through:
- `data-*` attributes on root `<div className="ff-app">`
- CSS custom properties set imperatively by `applyAccent` / `applyDensity` / `document.documentElement.dataset.theme`

Drive theming with `data-*` + CSS selectors. Keep component JSX free of theme branches.

## Selection Scope

Selection model: `{ ids: Set<string>; scopeFolderId: string }`.

Tiles read `data-scope-folder-id` from a parent via `closest()`. A tile shows selected only when its scope matches `selectionScopeFolderId`. Every container that holds selectable tiles must render `data-scope-folder-id={...}` on a wrapping element. Pass `selectedIds` + `selectionScopeFolderId` down as props.

## Storage Abstraction

Settings / icon cache / usage state goes through `CachedValueStore` and `CachedRecordStore` (`shared/storage-buckets.ts`). Settings use `sync-preferred` with local fallback + migration.

Extend the bucket helpers in `shared/storage.ts` rather than calling `extensionApi.storage.*` from new code.

## Archetype Classification & Organization Templates

Onboarding classifies the user's selected bookmark roots via two-stage pipeline:

1. **Profile** — `profileTree(roots, now?)` in `src/newtab/lib/tree-profile.ts` computes O(n) structural signals: `totalBookmarks`, `totalFolders`, `maxDepth`, `folderedRatio`, `giantFolderShare`, `duplicateUrlRate`, `domainDiversity`, `recentAdditionRatio`. Requires no async I/O; reuses existing tree.
2. **Classify** — `classify(profile)` in `src/newtab/lib/archetype-match.ts` applies margin-rule heuristics to return `ArchetypeMatch`: one of `hoarder`, `power-user`, `casual`, or `null`. Supports temporal overlay (Researcher) on power-user and professional nudge overlay; `CLASSIFY_DISABLED` flag descopes entire classifier.
3. **Template** — `TemplatePicker` presents 4 cards (all equal weight); classifier preselects one (badge + reason line). User chooses card (`data-selected`). Template ID maps to `ORGANIZATION_TEMPLATES` (in `src/shared/organization-templates.ts`) bundle: per-workspace `viewMode` + `sortMode` overrides (no layout preset, only view/sort).
4. **Apply** — Onboarding `handleFinish()` composes pending template into creation overrides: `onCreateWorkspace({ ...workspace, viewMode, sortMode, ... })`. Pending state persists in `OnboardingState` v2 (`recommendedArchetype`, `chosenArchetype`). Re-running classifier over existing workspace never silently applies — requires explicit user action (store state only, no patch).

## Icon Pipeline

Resolution order in `resolveAutomaticIcon` (`src/background/icons/icon-service.ts`); providers live in `icon-providers.ts`:
1. User override (persisted, never expires). **Scoped** since v9 (`shared/icon-scope.ts`): lookup order `exact:<url>` > `host:<hostname>` > `domain:<registrable root>`. Stored in IDB keyed by `overrideKey` (`ff-icons` DB v3; v1→v2 migrates per-URL to scope-keyed, v2→v3 removes unused `fit` field). Edit dialog has an "Apply icon to" segmented control (default: host).
2. Cache — in-memory in-flight dedup + persisted record (30-day TTL; stale non-generated records trigger a background refresh). **Keyed per host** (`icon:host:<hostname>`) since auto-resolution is purely host-derived — N bookmarks on a host share one resolution.
3. **Origin scrape** — fetch the site's own `https://<host>/` HTML, parse `<link rel>` icons + web-app manifest, then probe `apple-touch-icon*` / `android-chrome-192x192.png` / `favicon.ico` paths. Primary source; awaited first within `autoSourceTimeoutMs`. Guards: a cross-root redirect (login SSO page) discards the landed HTML and marks the host **gated**; same-host SVG icons are accepted without bitmap decode (capped at `maxSvgIconBytes`); ICO containers get their largest embedded PNG extracted (`ico-parse.ts`) since `createImageBitmap` can't decode ICO/SVG in workers.
4. **Google S2** — `google.com/s2/favicons`. Skipped for personal-infra hosts (S2 returns a generic globe for unreachable private domains) and when the `google.com` host permission is absent.
5. **Icon Horse** — `icon.horse/icon/<host>`. Last-resort favicon before image search; personal-infra and gated hosts skip straight to DDG (Icon Horse letter placeholders would poison the cache).
6. **DuckDuckGo image search** — `duckduckgo.com`, query built from brand/title/hostname terms. Supplies the first acceptable hit (`fetchDuckDuckGoFirstHit`) and powers the edit-dialog icon picker (`searchDuckDuckGoImages`). On Firefox, use `referrerPolicy="origin"` in the DDG iframe (src/newtab/components/EditDialog.tsx) — `no-referrer` causes Bing CDN to return 64px stubs that fail the `minEdge>=64px` size guard.

If all sources fail, a generated letter-tile record is cached (swept + retried later by `sweepGeneratedRecords`). Request deduplication (`inFlightIcons`) prevents concurrent fetches for the same host; resolutions are gated by `ResolutionSemaphore`. Newtab calls `getIcon(url, title)` via messaging; the page-level `favicon-cache.ts` has `invalidateFaviconCacheForScope` to refresh all same-host/domain tiles after a scoped override.

### Fetch Path: Chrome vs. Firefox

- **Chrome**: uses `fetch()` with `declarativeNetRequest` session rules (scripts/write-manifest.mjs) that inject `Access-Control-Allow-Origin: *` headers. Requires explicit host_permissions for S2, DDG, Icon Horse.
- **Firefox**: uses `XMLHttpRequest` on the background page (src/background/icons/platform.ts) via `firefoxSafeFetch()` / `xhrFetch()`. Host_permissions grant XHR cross-origin access; `['https://*/*']` covers all favicon services. `declarativeNetRequest` rules do NOT inject headers on Firefox background fetch() calls — the XHR path is the workaround. Branch at runtime via `isFirefox()` (checks navigator.userAgent).

## Dual-Target Builds

Same source compiles to both Chrome and Firefox (via Vite `--mode chrome|firefox`). Both targets must build green before commit.

**Browser-specific logic placement:**
- `shared/browser.ts` — `extensionApi` shim for Chrome/Firefox runtime differences (e.g., namespace detection).
- `src/background/icons/platform.ts` — `isFirefox()`, `firefoxSafeFetch()`, `xhrFetch()` for icon pipeline fetch branching. Kept separate from browser.ts to avoid extension API imports at module evaluation (breaks Vitest).
- `src/newtab/lib/platform.ts` — `IS_FIREFOX`, `MOD_KEY`, `ALT_KEY`, referrer-policy constants for UI (e.g., EditDialog DDG iframe).

**Manifest differences** (scripts/write-manifest.mjs):
- Chrome: `host_permissions` includes explicit favicon-service hosts (S2, DDG, Icon Horse) for declarativeNetRequest rules; `service_worker` in background.
- Firefox: `host_permissions` uses only `['https://*/*']` (XHR honors wildcard); `background.page` instead of service_worker (background page required for XHR CORS support).

Feature code MUST NOT have target-aware branches. All conditional logic funnels through the shims above.

## XSS / Security

- JSX text children handle escaping automatically — prefer them. If a new `innerHTML` becomes unavoidable, reintroduce a focused escape helper rather than copy-pasting `replaceAll` chains. No `innerHTML` in `src/`.
- Manifest permissions stay least-privilege. Justify any new permission in the PR.
- No secrets, no env-injected API keys. Extension calls only public favicon services.
