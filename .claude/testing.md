# Testing Approach

## Three Test Surfaces

- **Vitest unit tests** — `tests/unit/**/*.test.ts`. Pure logic only: utilities, helpers, pure functions (e.g. icon parsing, dock-mode resolution, URL normalization). Fast, no browser. Run with `npm run test:unit` or `npm run test:unit:watch`.
- **Playwright E2E (Chrome)** — `tests/specs/*.spec.ts`. User flows, integration, DOM + cross-context messaging. Chrome project runs all specs; Firefox project runs `icons.spec.ts` only. Playwright's built-in esbuild TS transform wires `@/` path alias (tsconfig `paths` resolved at runtime with zero extra config). Run with `npm test` (default: chrome) or `npm run test:chrome` / `npm run test:firefox`.
- **Puppeteer WebDriver BiDi suite (Firefox)** — `tests/firefox-e2e/specs/**/*.test.ts`. Broad Firefox E2E coverage — bookmarks, boot, context-menu, icons, middle-click, onboarding, search, settings, workspaces. Uses Puppeteer + Firefox WebDriver BiDi (the only way to load a MV3 extension in headless Firefox; Playwright's juggler backend cannot). Separate Vitest config + separate `vitest run -c` invocation so it doesn't get picked up by `npm run test:unit`. Run with `npm run test:firefox:e2e` or `npm run test:firefox:e2e:build`.

### Why Three?

- **Unit** — fast and deterministic for extracted pure logic.
- **Playwright Chrome** — primary harness: real Chrome/MV3 support, Playwright maturity, live-network fallbacks built in.
- **Puppeteer Firefox** — the only path to full Firefox coverage: WebDriver BiDi can install an MV3 extension and set the required UUID pref. E2E-only, no unit or component coverage.

## Storage Test Flag & Dist

Chrome Playwright specs load a **test build** to eliminate flake from `chrome.storage.sync`'s async flush race:

- `npm run build:chrome:test` — builds `dist/chrome-test` with `__FF_TEST_STORAGE_LOCAL__` true (defined in vite.config.mjs). The flag forces storage writes onto `chrome.storage.local` instead of sync-preferred, killing the persists-after-reload race under parallel load. Gitignored, test-only.
- `tests/fixtures/launch.ts` — Chrome specs launch `dist/chrome-test`, NOT `dist/chrome`. Firefox specs launch `dist/firefox` (no flag; Firefox's async storage model has no sync race).
- `dist/chrome` — the real release artifact for `ff-release` / publish, byte-identical to before. The flag is compile-time only, never a runtime toggle.
- Flake eliminated, so the suite runs `retries: 0`.

## Component/React Testing: Intentionally Out of Scope

**Decision**: Settings panels and other React components stay E2E-only. No RTL or component-level unit testing.

**Reason**: Component tests either test implementation (brittle — they fail on safe refactors) or redundantly retest E2E coverage. The architecture (state in `App.tsx`, presentational children, extracted pure functions) already isolates unit-testable logic from render. Pure logic lives in unit tests (`lib/`, `shared/`); components are validated via E2E.

**Deferred E2E markers**: some hooks are documented as E2E-only in their own test files, with reasons, rather than given fake unit coverage:
- `tests/unit/state/*.test.ts` — `useSelection`, `useWorkspaceActions`, `useToasts`, `useContextMenuBuilder` (state hooks with side effects that need the full component tree)
- `tests/unit/interaction/deferred-to-e2e.test.ts` — all 8 interaction hooks (`useDrag`, `useMarquee`, `useKeyboardNav`, etc.; require real DOM + event simulation)

## Evidence specs

Screenshot-driven specs that prove a UI feature works — **not** assertion tests. Reviewers see the
evidence in a sticky PR comment without checking out the branch.

**Rule:** UI-affecting PRs MUST stage an evidence spec. Non-UI PRs (refactor, docs, config) skip
them; CI skips gracefully.

**Evidence specs are NEVER committed to this repo.** A per-PR spec is throwaway scaffolding and its
screenshots are deleted on PR close, so committing one left a file nobody would ever run again in a
public repo's permanent history. Specs live on the disposable orphan `pr-evidence` branch at
`pr-<N>/spec/`, beside the screenshots they produce; CI copies them in at capture time and the
cleanup job deletes spec + PNGs together on close.

**Location & execution:**
- Authoring: write to `tests/evidence/pr/<name>.evidence.spec.ts` — **gitignored**, so a stray
  `git add -A` can't leak it into `main`. Push it to `pr-<N>/spec/` on `pr-evidence` (exact
  commands in `tests/evidence/README.md`).
- Runner: `playwright.evidence.config.ts` (chrome-only, workers:1, deterministic ordering).
  `testDir` is `tests/evidence/pr` — scoping it there is what keeps a PR's evidence comment to
  that PR's own screenshots.
- Script: `npm run evidence` (builds `dist/chrome-test` + runs `tests/evidence/pr/` + writes
  PNGs to `tests/evidence/output/`).
- Harness: `capture(page, testInfo, label)` names output `<spec-basename>--<label>.png`;
  `settle(locator)` waits out CSS animations (dialogs run `ffScaleIn` for 240ms — capture
  without it and you screenshot a half-faded dialog).
- Committed here: `evidence.ts` (harness), `global-setup.ts`, and
  `example-edit-dialog.evidence.spec.ts` — a reference to copy that sits outside `testDir`, so
  it never runs but is still typechecked by `tsconfig.test.json`.

**Exclusion from other suites:** Evidence specs run **only** via `playwright.evidence.config.ts`.
`npm test` / `test:chrome` / `test:firefox` use `playwright.config.ts` (testDir `tests/specs`).
`test:unit` scans `tests/unit/**/*.test.ts`. `test:firefox:e2e` scans `tests/firefox-e2e/specs/**/*.test.ts`.
Zero collision.

**CI consumption:** `.github/workflows/pr-evidence.yml` runs on each PR. Gate: does
`pr-<N>/spec/*.evidence.spec.ts` exist on `pr-evidence`? If so it copies the spec into
`tests/evidence/pr/`, builds, captures, publishes PNGs to `pr-<N>/`, and posts a sticky comment
embedding them plus a link back to the spec — evidence a reviewer can't audit is worth nothing. No
staged spec → graceful skip (expected for non-UI work). On close, the cleanup job deletes `pr-<N>/`
entirely. No assertions and no failure gate: a missing screenshot just means the PR carries no
evidence.

## Layout

- `playwright.config.ts` — Chrome (all specs) + Firefox (icons-only) projects; global-setup verifies `dist/{chrome-test,firefox}` exist.
- `tests/global-setup.ts` — Playwright global setup; asserts `dist/{chrome-test,firefox}` exist (does NOT build). Both are checked on every run, whichever project you select.
- `tests/firefox-e2e/global-setup.ts` — Puppeteer suite global setup; asserts `dist/firefox` exists.
- `tests/fixtures/launch.ts` — Single source of truth for browser launch (Chrome loads `dist/chrome-test`, Firefox loads `dist/firefox`).
- `tests/fixtures/` — Playwright fixtures: `world` (worker-scoped with seeded bookmarks), `extension-context`, `test-data`, `bookmark-helpers`, `seeding`, `selectors`.
- `tests/firefox-e2e/` — Puppeteer suite: separate `launch.ts`, `seed.ts`, `selectors.ts`, `wait.ts`, `vitest.config.ts` (with `@/` alias wired).
- `tests/specs/*.spec.ts` — Playwright E2E specs (one file per user-flow area).
- `tests/unit/**/*.test.ts` — Vitest unit tests, mirrored to source layout.

## Npm Scripts

```bash
# Unit tests
npm run test:unit              # Vitest: tests/unit/**/*.test.ts
npm run test:unit:watch        # Vitest watch mode

# Playwright E2E (Chrome + Firefox icons)
npm test                       # Playwright: all specs on chrome + icons.spec.ts on firefox
npm run test:chrome            # Chrome project only
npm run test:firefox           # Firefox project only (icons.spec.ts)
npm run test:ui                # Playwright interactive debugger
npm run test:headed            # Chrome project with visible window
npm run test:report            # Generate HTML report

# Puppeteer Firefox E2E
npm run test:firefox:e2e       # Run tests/firefox-e2e/**/*.test.ts (requires dist/firefox)
npm run test:firefox:e2e:build # Build dist/firefox first, then run firefox-e2e

# Full CI
npm run test:build             # Build everything (dist/chrome + dist/chrome-test + dist/firefox), run Playwright
npm run test:ci                # Same as test:build (used in CI/CD)
npm run test:all               # build + build:chrome:test + Playwright test + test:firefox:e2e
```

## Workflow

When editing code exercised by tests:

```bash
npm run test:unit              # Vitest — fast, run first
npm run build                  # rebuild dist/chrome + dist/firefox (for release artifact validation)
npm run build:chrome:test      # rebuild dist/chrome-test (for Playwright)
npm test                       # run Playwright chrome project
npm run test:firefox           # if change touches icon code
npm run test:firefox:e2e       # if change needs broad Firefox validation
```

All-in-one: `npm run test:build` (build + build:chrome:test + Playwright) or `npm run test:all`
(same, plus Puppeteer Firefox). `npm run test:ui` for interactive debugging.

## Writing Tests

### Unit Tests (Vitest)

- Extract pure logic into utilities (`lib/`, `shared/`) — then unit-test them.
- Test pure functions, reducers, builders, parsers — anything that takes input and returns output with no side effects.
- No mocking of browser APIs; reach for integration tests if browser APIs are required.
- Fast, deterministic, run in parallel (`fullyParallel: true` by default).

### E2E Tests (Playwright)

- Add a new spec to `tests/specs/` for new user-flow behavior. Use `@/` alias for cross-area imports; Playwright resolves tsconfig `paths` at runtime.
- Tests should encode *why* the behavior matters (the user-visible outcome), not just *what* the current DOM happens to look like. A test that can't fail when business logic changes is wrong.
- Reuse fixture data + helpers. Seed bookmarks through `bookmark-helpers.ts` rather than reaching into `chrome.bookmarks.*` directly.
- Keep specs deterministic — no time-based flake. `fullyParallel: false` (tests within a file run serially); spec files run in parallel across `workers: 3` (CI: 2), each worker getting its own isolated Chrome + profile via the world fixture. **`retries: 0`** (eliminated via storage.local test flag).
- Seed through the `world` fixture (`tests/fixtures/world.ts`): import `{ test, expect }` from it for the promo-seeded `world` + `newtabPage`, or `freshPage` for unseeded fresh-install flows. `tests/fixtures/seeding.ts` / `selectors.ts` hold the typed seeding + locator helpers.

### E2E Tests (Puppeteer Firefox)

- Add a new spec to `tests/firefox-e2e/specs/` using the same pattern as Playwright specs.
- Use `tests/firefox-e2e/launch.ts` to launch Firefox; `seed.ts` for seeding; `selectors.ts` for locators; `wait.ts` for wait utilities.
- Puppeteer + WebDriver BiDi test only on Firefox (not a Chrome path); Playwright is the primary E2E harness.
