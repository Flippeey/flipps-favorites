# Testing Approach

## Three Test Surfaces

- **Vitest unit tests** — `tests/unit/**/*.test.ts`. Pure logic only: utilities, helpers, pure functions (e.g. icon parsing, dock-mode resolution, URL normalization). Fast, no browser. Run with `npm run test:unit` or `npm run test:unit:watch`.
- **Playwright E2E (Chrome)** — `tests/specs/*.spec.ts`. User flows, integration, DOM + cross-context messaging. Chrome project runs all specs; Firefox project runs `icons.spec.ts` only. Playwright's built-in esbuild TS transform wires `@/` path alias (tsconfig `paths` resolved at runtime with zero extra config). Run with `npm test` (default: chrome) or `npm run test:chrome` / `npm run test:firefox`.
- **Puppeteer WebDriver BiDi suite (Firefox)** — `tests/firefox-e2e/specs/**/*.test.ts` (9 spec files). Broad Firefox E2E coverage — bookmarks, boot, context-menu, icons, middle-click, onboarding, search, settings, workspaces. Uses Puppeteer + Firefox WebDriver BiDi (the only way to load a MV3 extension in headless Firefox; Playwright's juggler backend cannot). Separate Vitest config + separate `vitest run -c` invocation so it doesn't get picked up by `npm run test:unit`. Run with `npm run test:firefox:e2e` or `npm run test:firefox:e2e:build`.

### Why Three?

**Unit**: Vitest is fast and deterministic for pure logic extraction.

**Playwright Chrome**: All specs run via Playwright on Chrome. All projects (product + test) use Chrome as primary because: real Chrome/MV3 support, Playwright maturity, live-network fallbacks built in.

**Puppeteer Firefox**: Full Firefox coverage via Puppeteer's WebDriver BiDi support (unique ability to install a MV3 extension + set the required UUID pref). Validates both targets; E2E-only (no unit/component coverage).

## Storage Test Flag & Dist

Chrome Playwright specs load a **test build** to eliminate flake from `chrome.storage.sync`'s async flush race:

- `npm run build:chrome:test` — builds `dist/chrome-test` with `__FF_TEST_STORAGE_LOCAL__` define true (set in vite.config.mjs). This compile-time flag forces all storage writes onto `chrome.storage.local` instead of sync-preferred, eliminating the persists-after-reload race under parallel test load. `dist/chrome-test` is gitignored test-only output.
- `tests/fixtures/launch.ts` — Chrome specs launch `dist/chrome-test`, NOT `dist/chrome`. Firefox specs launch `dist/firefox` (not built with the flag; no sync race on Firefox's async storage model).
- `dist/chrome` (the real release artifact used by `ff-release` / publish) stays unmodified and byte-identical to before. The flag is compile-time only, not a runtime toggle.
- **Flake elimination validated** (wave 5/t10, 2026-07-06): 3 consecutive full runs (177 tests each = 531+ test executions) all passed clean with `retries: 0`, confirming the storage.local fix eliminated the flake that previously required `retries: 1`.

## Component/React Testing: Intentionally Out of Scope

**Decision**: Settings panels and other React components stay E2E-only. No RTL or component-level unit testing.

**Reason**: Component tests either test implementation (brittle, fail on safe refactors) or retest E2E coverage redundantly. The extension's architecture (state in `App.tsx`, presentational children, extracted pure functions) already isolates unit-testable logic from component render. Pure logic lives in unit tests (`lib/`, `shared/`); components are validated via E2E.

**Deferred E2E markers**: Some hooks are documented as E2E-only with reasons in their own test files rather than given fake unit coverage:
- `tests/unit/state/*.test.ts` — `useSelection`, `useWorkspaceActions`, `useToasts`, `useContextMenuBuilder` (state hooks with side effects that need the full component tree)
- `tests/unit/interaction/deferred-to-e2e.test.ts` — all 8 interaction hooks (`useDrag`, `useMarquee`, `useKeyboardNav`, etc.; require real DOM + event simulation)

## Layout

- `playwright.config.ts` — Chrome (all specs) + Firefox (icons-only) projects; global-setup verifies `dist/{chrome,firefox}` exist.
- `tests/global-setup.ts` — Playwright global setup; asserts `dist/{chrome,firefox}` exist (does NOT build).
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

Or use the all-in-one:
```bash
npm run test:build             # build + build:chrome:test + Playwright
npm run test:all               # build + build:chrome:test + Playwright + Puppeteer Firefox
```

Use `npm run test:ui` for interactive Playwright debugging.

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
