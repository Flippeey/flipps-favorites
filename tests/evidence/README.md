# Evidence specs

An evidence spec drives a PR's **new** UI functionality to a demonstrative
moment and saves a labeled screenshot, so a reviewer can see the feature
working without checking out the branch. It is not a test: it makes no
assertions and never gates CI. A red screenshot run just means no evidence
was produced for that PR.

## Evidence specs are never committed to this repo

A per-PR spec is throwaway review scaffolding. Its screenshots are already
deleted when the PR closes, so the spec is exactly as disposable — keeping it
would leave a file nobody ever runs again in a public repo's permanent history.

So the spec lives on the disposable orphan **`pr-evidence`** branch, alongside
the screenshots it produces:

```
pr-evidence branch (orphan, never merged)
  pr-64/
    spec/folder-icons.evidence.spec.ts   <- you push this
    folder-icons--dialog-open.png        <- CI writes these
    ...
```

CI copies `pr-<N>/spec/*.evidence.spec.ts` into `tests/evidence/pr/` (gitignored)
at capture time and runs only that. On close, the cleanup job deletes `pr-<N>/`
entirely — spec and screenshots together. Nothing reaches `main`.

`tests/evidence/pr/` is gitignored precisely so a stray `git add -A` on a PR
branch cannot leak a spec into `main`.

## Authoring a spec

1. Write it at `tests/evidence/pr/<name>.evidence.spec.ts` (gitignored — it stays
   local). Copy `../example-edit-dialog.evidence.spec.ts` as a starting point.
2. Run `npm run evidence` — builds `dist/chrome-test`, runs everything in
   `tests/evidence/pr/`, writes PNGs to `tests/evidence/output/` (gitignored).
   **Look at the PNGs.** A capture taken mid-animation or of the wrong element
   is worse than no evidence.
3. Push the spec to the orphan branch under this PR's directory:

   ```bash
   PR=64
   git fetch origin pr-evidence
   WT=$(mktemp -d)
   git worktree add "$WT" pr-evidence     # or: --orphan pr-evidence, if it doesn't exist yet
   mkdir -p "$WT/pr-$PR/spec"
   cp tests/evidence/pr/*.evidence.spec.ts "$WT/pr-$PR/spec/"
   git -C "$WT" add "pr-$PR/spec"
   git -C "$WT" commit -m "evidence: spec for pr-$PR"
   git -C "$WT" push origin HEAD:pr-evidence
   git worktree remove "$WT"
   ```

4. Push (or re-push) the PR branch. CI captures and posts the sticky comment,
   which links back to the spec so a reviewer can audit how the evidence was made.

## Rules

- Reuse the normal Playwright fixtures: `../../fixtures/world.js` (`world`,
  `newtabPage`) and `../../fixtures/bookmark-helpers.js`, same as
  `tests/specs/*.spec.ts`. Do not use `scripts/promo/lib.mjs` — it launches
  against `dist/chrome`, the release artifact, not the `dist/chrome-test`
  build this suite runs against.
- Capture with `capture(page, testInfo, label)` from `../evidence.js`. Output is
  `<spec-basename>--<label>.png`.
- Call `settle(locator)` before capturing anything animated. Dialogs run
  `ffScaleIn` for 240ms; a screenshot taken the instant one becomes visible
  catches it half-transparent and scaled over the page behind it.
- Keep each spec small: a handful of labeled captures at the moments that
  actually show the new behavior (before/after a toggle, a dialog open,
  a result state) — not a full walkthrough.
- Write captures so they mean something to someone who never read the review
  thread. Label the behavior, not the bug number.

## Files that DO live here

- `evidence.ts` — the harness (`capture`, `settle`).
- `global-setup.ts` — asserts `dist/chrome-test` exists.
- `example-edit-dialog.evidence.spec.ts` — a reference to copy. It sits outside
  `playwright.evidence.config.ts`'s `testDir` (`tests/evidence/pr`), so it never
  runs; it is typechecked by `tsconfig.test.json`, which is what keeps it honest
  if the harness API changes.
