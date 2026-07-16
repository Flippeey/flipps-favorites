import { basename } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';

const OUTPUT_DIR = 'tests/evidence/output';

/**
 * Wait for an element's own CSS animations to finish before capturing it.
 *
 * Dialogs run `ffScaleIn` for 240ms (dialogs.css), so a screenshot taken the
 * moment they become visible catches them mid-fade — half-transparent and
 * scaled over the page behind. Not a flake guard: `getAnimations()` without
 * `{ subtree: true }` returns only this element's finite animations, so this
 * can't hang on a looping descendant spinner.
 *
 * `finished` REJECTS with AbortError if an animation is cancelled mid-flight —
 * which happens for real here, e.g. `.ff-dialog[data-closing]` swaps ffScaleIn
 * for ffScaleOut. Swallow it: a cancelled animation is still a settled one for
 * screenshot purposes, and letting it throw would fail the whole evidence run.
 */
export async function settle(target: Locator): Promise<void> {
  await target.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );
}

/**
 * Capture a labeled PNG for an evidence spec.
 *
 * Naming: `<spec-basename>--<label>.png` in tests/evidence/output/ (gitignored).
 * `<spec-basename>` is derived from the running test's file, so specs never
 * need to repeat their own filename by hand and captures from different
 * specs can't collide.
 */
export async function capture(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const specBasename = basename(testInfo.file).replace(/\.evidence\.spec\.ts$/, '');
  await page.screenshot({ path: `${OUTPUT_DIR}/${specBasename}--${label}.png` });
}
