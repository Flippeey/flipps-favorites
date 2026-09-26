import { basename } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';

const OUTPUT_DIR = 'tests/evidence/output';

/**
 * Wait for animations to finish on `target` (and its descendants, if
 * `subtree` is set) before a screenshot is taken.
 *
 * Dialogs run `ffScaleIn` for 240ms (dialogs.css), so a screenshot taken the
 * moment they become visible catches them mid-fade — half-transparent and
 * scaled over the page behind. Without `subtree`, `getAnimations()` returns
 * only the target's own finite animations, so a call scoped to one element
 * can't hang on a looping descendant spinner elsewhere on the page.
 *
 * `finished` REJECTS with AbortError if an animation is cancelled mid-flight —
 * which happens for real here, e.g. `.ff-dialog[data-closing]` swaps ffScaleIn
 * for ffScaleOut. Swallow it: a cancelled animation is still a settled one for
 * screenshot purposes, and letting it throw would fail the whole evidence run.
 */
async function waitForAnimations(target: Locator, subtree = false): Promise<void> {
  await target.evaluate(
    (el, subtree) =>
      Promise.all(el.getAnimations({ subtree }).map((a) => a.finished.catch(() => undefined))),
    subtree,
  );
}

/**
 * Wait for an element's own CSS animations to finish before interacting with
 * it further. `capture()` already does this for the whole page before every
 * screenshot, so specs only need this mid-flow — e.g. waiting for a dialog's
 * open transition before reading its fields.
 */
export async function settle(target: Locator): Promise<void> {
  await waitForAnimations(target);
}

/**
 * Capture a labeled PNG for an evidence spec.
 *
 * Naming: `<spec-basename>--<label>.png` in tests/evidence/output/ (gitignored).
 * `<spec-basename>` is derived from the running test's file, so specs never
 * need to repeat their own filename by hand and captures from different
 * specs can't collide.
 *
 * Before screenshotting, the page is brought to front, any running
 * animations (page-wide) are given a chance to finish, and two animation
 * frames are awaited. A tab that isn't frontmost, or a page whose compositor
 * hasn't produced a frame yet, makes Chromium's screenshot protocol fail
 * outright rather than return a stale image, which is what a capture taken
 * immediately after navigation or a state change can hit under xvfb.
 */
export async function capture(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  await page.bringToFront();
  await waitForAnimations(page.locator(':root'), true);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

  const specBasename = basename(testInfo.file).replace(/\.evidence\.spec\.ts$/, '');
  await page.screenshot({ path: `${OUTPUT_DIR}/${specBasename}--${label}.png` });
}
