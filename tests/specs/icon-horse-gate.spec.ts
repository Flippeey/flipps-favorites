/**
 * Icon Horse placeholder gate — E2E spec (SKIPPED).
 *
 * SKIP REASON: This spec depends on un-mocked live third-party services
 * (icon.horse, duckduckgo.com, github.com) and its core assertion
 * `not.toBe('iconhorse')` is non-falsifiable: it passes whenever DDG or
 * origin returns ANYTHING, even if the placeholder gate never ran.
 * A test that can't fail when the logic breaks is wrong (Rule 9).
 *
 * REPLACEMENT: The placeholder-gate decision logic is now deterministically
 * covered by Vitest unit tests in tests/unit/icons/placeholder-gate.test.ts,
 * which inject synthetic pixel data and assert the gate rejects monotone-grey
 * placeholders and accepts real distinct-color favicons. Those tests genuinely
 * fail if the gate logic is removed.
 *
 * WHAT REMAINS UNTESTED HERE: The OffscreenCanvas 16x16 downscale step
 * (createImageBitmap + drawImage → getImageData) that feeds pixel data to the
 * decision helper. That canvas path is exercised live by the extension but
 * cannot run in Vitest/Node.
 */
import { test } from '../fixtures/extension-context.js';

test.describe('Icon Horse placeholder gate', () => {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  test.skip(true, 'Non-falsifiable: replaced by deterministic unit tests in tests/unit/icons/placeholder-gate.test.ts');
});
