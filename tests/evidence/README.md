# Evidence specs

An evidence spec drives a PR's **new** UI functionality to a demonstrative
moment and saves a labeled screenshot, so a reviewer can see the feature
working without checking out the branch. It is not a test: it makes no
assertions and never gates CI. A red screenshot run just means no evidence
was produced for that PR.

## Rules

- File: `tests/evidence/<name>.evidence.spec.ts`. Only files matching this
  glob, in this directory, are picked up by the evidence runner — they are
  invisible to `npm test`, `test:unit`, and `test:firefox:e2e` (separate
  `testDir`/`include` roots, see `playwright.evidence.config.ts`).
- Reuse the normal Playwright fixtures: `../fixtures/world.js` (`world`,
  `newtabPage`) and `../fixtures/bookmark-helpers.js`, same as
  `tests/specs/*.spec.ts`. Do not use `scripts/promo/lib.mjs` — it launches
  against `dist/chrome`, the release artifact, not the `dist/chrome-test`
  build this suite runs against.
- Capture screenshots with `capture(page, testInfo, label)` from
  `./evidence.js`. Output lands in `tests/evidence/output/` (gitignored) as
  `<spec-basename>--<label>.png`.
- Keep each spec small: a handful of labeled captures at the moments that
  actually show the new behavior (before/after a toggle, a dialog open,
  a result state) — not a full walkthrough.

## Running

`npm run evidence` builds `dist/chrome-test` and runs every
`*.evidence.spec.ts` file, writing PNGs to `tests/evidence/output/`.

## CI

The PR-evidence workflow (see plan doc for T4) runs `npm run evidence`,
uploads the resulting PNGs to an orphan `pr-evidence` branch, and links them
into a sticky PR comment. A PR with no evidence spec is a normal, expected
case — the workflow skips silently rather than failing.
