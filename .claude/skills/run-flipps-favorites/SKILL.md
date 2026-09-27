---
name: run-flipps-favorites
description: Run, launch, drive, and screenshot the Flipp's Favorites browser extension in Chrome via Playwright. Use to click through the extension's new-tab page, exercise a feature you just changed, or capture a screenshot of the running UI. Loads the built MV3 extension into a real Chrome and drives the chrome-extension:// newtab page.
---

# Run Flipp's Favorites (Chrome, via Playwright)

Flipp's Favorites is a Chrome MV3 extension whose UI is the new-tab page
(`newtab.html`). You can't just `npm start` it — it has to be loaded into Chrome as
an unpacked extension, then driven at its `chrome-extension://<id>/newtab.html` URL.

The driver — [driver.mjs](driver.mjs) (at
`.claude/skills/run-flipps-favorites/driver.mjs`) —
launches Chrome with the built `dist/chrome-test` extension loaded (reusing the same
flags as `launchChrome()` in `tests/fixtures/launch.ts`), derives the extension id from its
service worker, opens the newtab page, and exposes click / type / eval / screenshot
commands. Reuses the already-installed `@playwright/test` — **no new deps**.

> Paths below are relative to the repo root.

## No visible browsers

Every launch here runs headless by default and must stay that way on a shared or
remote machine — a headed Chrome window steals focus on the desktop. Run the driver
itself under `env -u DISPLAY -u WAYLAND_DISPLAY nice -n 19`, e.g.:

```bash
env -u DISPLAY -u WAYLAND_DISPLAY nice -n 19 node .claude/skills/run-flipps-favorites/driver.mjs --run /tmp/ff-cmds.txt
```

Only pass `--headed` (interactive human debugging on your own machine) when you
deliberately want a window on screen.

## Prerequisites

Playwright is already a dev dependency. Just install + ensure the Chromium binary:

```bash
npm install
npx playwright install chromium
```

## Build (REQUIRED before launching)

The driver loads `dist/chrome-test` — it does **not** build. Build first or you get
`Manifest file is missing or unreadable`:

```bash
npm run build:chrome:test
```

`dist/chrome-test` (not `dist/chrome`) forces storage writes onto
`chrome.storage.local`, the same test build the project's own Playwright specs use —
it sidesteps the `chrome.storage.sync` async-flush race that flakes reads back right
after a write.

## Run — agent path (batch mode)

Write the commands to a file, run `--run`, read the output + screenshots. Each line
runs sequentially (awaited), then Chrome quits. This is the path to use from a
shell — it does not race like piping into the REPL does.

```bash
cat > /tmp/ff-cmds.txt <<'EOF'
launch
navigate
seed-promo
screenshot home
click-text Personal
screenshot personal
text .ff-app
quit
EOF
env -u DISPLAY -u WAYLAND_DISPLAY nice -n 19 node .claude/skills/run-flipps-favorites/driver.mjs --run /tmp/ff-cmds.txt
```

`--run` exits non-zero (1) if any command in the file fails (an `ERROR:`
log line, an unknown command, or an unreadable script file) and 0 when every
command succeeds — check the exit code in the shell before trusting the output.

Screenshots land in [screenshots/](screenshots/) (i.e.
`.claude/skills/run-flipps-favorites/screenshots/<name>.png`). Read the PNG back
to confirm the UI actually rendered.

### Commands

| Command | Effect |
|---|---|
| `launch` | Build-checked launch of Chrome + extension; prints `chrome-extension://<id>` |
| `navigate` | Open `newtab.html`, wait for `.ff-app` |
| `seed-promo` | Seed the rich 5-workspace world (Work/Personal/AI/Design/Gaming) + dock, reload |
| `seed-minimal [count]` | Seed one workspace with `count` flat bookmarks (default 6), reload |
| `clear` | Wipe all bookmarks + workspace records |
| `skip-onboarding` | Dismiss onboarding (no seed), reload |
| `screenshot [name]` | Save `screenshots/<name>.png` (default `ss-<ts>`) |
| `click <selector>` | `querySelector(sel).click()` |
| `click-text <text>` | Click first button/link/`[role=button]` matching the text |
| `fill <selector> <text>` | Fill an input — the selector is the first word (no spaces); the rest of the line is the text |
| `type <text>` | Type at the keyboard |
| `press <key>` | Press a key (e.g. `Escape`, `Control+K`) |
| `wait <selector>` | Wait up to 10s for a selector |
| `eval <expression>` | Evaluate JS in the page, print JSON result |
| `text [selector]` | Print `innerText` (whole body if no selector) |
| `console-errors` / `network-errors` | Listen for 1s from when the command runs, then report console errors / responses >= 400. Errors emitted by earlier commands are never seen, so a 0 count says nothing about the steps before it |
| `url` / `reload` / `quit` / `help` | self-explanatory |

Selectors follow the project's `data-*` DOM contract: tiles are `[data-item-id]` /
`[data-item-kind]`, selection scopes are `[data-scope-folder-id]`, top-level shell is
`.ff-app`. A fresh profile starts on the onboarding modal (Skip / Next buttons).

### Seeding starting-point bookmark data

A fresh launch has **no bookmarks** (onboarding only). To exercise a populated UI,
run a seeder right after `navigate` — each one wipes existing state, installs its
data, and reloads:

- `seed-promo` — the realistic demo world: 5 workspaces with real-looking bookmarks
  + folders + dock. Best for general click-through / screenshots.
- `seed-minimal [count]` — a single "Minimal" workspace with `count` predictable
  bookmarks (`BM 01`, `BM 02`, …). Best for deterministic assertions.
- `clear` then your own `eval` calls if you need a fully custom tree.

These reuse the project's **single source of truth** for seed data
(`src/shared/seed-data.ts` via `scripts/promo/lib.mjs`, plus
`DEFAULT_WORKSPACE_SETTINGS` from `tests/fixtures/test-data.ts`) — no duplicated
fixtures. This relies on Node ≥22.18 stripping TS types on import; the repo pins Node 24 via `.nvmrc`.
For richer archetype trees (deep-organized, flat-hoarder) see the helpers in
`tests/fixtures/bookmark-helpers.ts`.

## Run — human path (interactive REPL)

```bash
node .claude/skills/run-flipps-favorites/driver.mjs --headed
```

Then type commands at the `driver>` prompt (`launch`, `navigate`, `screenshot`, …).
A real Chrome window opens. Type `quit` to clean up. Do **not** pipe a command
stream into this mode — readline doesn't await between lines, so `navigate` can fire
before `launch` finishes. Use `--run` for scripted/agent use instead.

## Regression checks (the project's own suites)

For anything beyond a manual click-through, prefer the project's own check:

```bash
npm run verify   # typecheck -> test:unit -> build -> build:chrome:test -> playwright chrome -> firefox e2e
```

`npm run verify` is the full regression gate and already runs everything headless.
Reach for this driver for interactive exploration and screenshots, not as a
substitute for the test suites.

## Gotchas

- **Headless by default now, via the `--headless=new` Chrome arg, not Playwright's
  `headless` option.** Playwright's own boolean headless mode (`headless: true`)
  never registers the MV3 service worker, so the launch always passes
  `headless: false` to Playwright and instead adds Chrome's own `--headless=new` arg
  by default. Passing `--headed` drops that arg, giving a real visible window.
  There is no other way to get a visible window; a bare `--headless` flag does
  nothing (it's not read) and is never needed.
- **The old boolean-only headless mode is gone.** `headless: true` **without**
  `--headless=new` timed out with `Timeout ... waiting for event "serviceworker"` —
  the extension never started, so the extension id couldn't be derived. That path is
  no longer reachable from this driver; `--headed` is the only escape hatch, and it
  runs fully headed, not the old broken mode.
- **Build path is 4 levels up from the driver.** The driver lives at
  `.claude/skills/run-flipps-favorites/driver.mjs`; the extension is at the *repo
  root* `dist/chrome-test`. `fileURLToPath(import.meta.url)` returns the file, so
  reaching root needs four `..` (file → run-flipps-favorites → skills → .claude →
  root). Three lands you at `.claude/dist/chrome-test`, which yields the Chrome
  popup `Failed to load extension from: ...\.claude\dist\chrome-test. Manifest file
  is missing`.
- **Must build before launch.** `dist/chrome-test` is not auto-built; the driver
  preflights `manifest.json` and tells you to run `npm run build:chrome:test` if
  it's absent.
- **Fresh profile = onboarding.** Each launch uses a throwaway temp profile, so you
  always start on the onboarding modal. Click `Skip` (or `click-text Next`) to reach
  the dashboard, or run `seed-promo` / `seed-minimal` after `navigate` to skip
  onboarding and populate bookmarks in one step.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Manifest file is missing or unreadable` (Chrome popup) | Run `npm run build:chrome:test`; confirm `dist/chrome-test/manifest.json` exists. |
| `Timeout ... waiting for event "serviceworker"` | Something dropped `--headless=new` from the launch args without adding `--headed`. Use the driver unmodified, or pass `--headed`. |
| `headless: expected boolean, got string` | Playwright 1.58+ rejects `headless: 'new'` — the option is a boolean now; the flag lives in `args`, not `headless`. Already handled in this driver. |
| REPL ran `navigate` before `launch` finished | You piped into the interactive REPL. Use `--run <file>` instead. |
| `npx playwright install chromium` needed | Chromium binary not present; install it. |
| A visible Chrome window appears on a shared/remote box | You launched without `env -u DISPLAY -u WAYLAND_DISPLAY`, or passed `--headed` by mistake. |
