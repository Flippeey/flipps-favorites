import { basename } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

const OUTPUT_DIR = 'tests/evidence/output';

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
