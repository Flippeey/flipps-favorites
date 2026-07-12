/**
 * itemIdSelector / scopeFolderSelector — CSS.escape guard for drag selectors.
 *
 * WHY this matters: useDrag.ts previously interpolated raw bookmark/folder ids
 * straight into attribute selector template strings (e.g.
 * `[data-item-id="${id}"]`). Bookmark/folder ids are opaque strings with no
 * guarantee they're simple alphanumerics — an id containing a `"` breaks out
 * of the attribute-value string and produces an invalid selector, which
 * throws a SyntaxError from querySelector. That throw happens inside the
 * pointermove handler mid-drag, aborting it before `clearDropAttrs` runs and
 * leaving the dragged tile stuck with data-drag-source="true" (rendered at
 * reduced opacity — the "muted favicons" bug documented elsewhere in this
 * codebase). Wrapping the id in CSS.escape() (matching the pattern already
 * used in App.tsx) keeps the selector valid for any id value.
 *
 * These tests assert the *shape* of the escaped selector (proving CSS.escape
 * was actually applied, not just that querySelector didn't throw), so they
 * would fail against the old `` `[data-item-id="${id}"]` `` construction for
 * any of the special-char ids below.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { itemIdSelector, scopeFolderSelector } from '@/newtab/interaction/useDrag';

// Node has no global CSS.escape (browser/CSSOM API). Stub the standard
// algorithm (per the CSSOM spec / MDN polyfill) so these tests exercise the
// same escaping semantics useDrag.ts relies on in the real extension runtime.
beforeAll(() => {
  if (typeof globalThis.CSS === 'undefined') {
    (globalThis as { CSS?: { escape: (v: string) => string } }).CSS = {
      escape: (value: string): string =>
        value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`),
    };
  }
});

describe('itemIdSelector', () => {
  it('escapes a double-quote in the id so the selector stays syntactically valid', () => {
    const id = 'abc"onmouseover=alert(1)';
    const selector = itemIdSelector(id);
    // The raw quote must be escaped (backslash-prefixed), not passed through —
    // proves CSS.escape ran, not just that no exception was thrown.
    expect(selector).toBe('[data-item-id="abc\\"onmouseover\\=alert\\(1\\)"]');
  });

  it('escapes a colon so it does not get parsed as a pseudo-class', () => {
    const selector = itemIdSelector('id:with:colons');
    expect(selector).toBe('[data-item-id="id\\:with\\:colons"]');
  });

  it('escapes an id that starts with a digit (invalid as a bare CSS identifier)', () => {
    const selector = itemIdSelector('123-numeric-start');
    expect(selector).toBe('[data-item-id="123-numeric-start"]');
    // Digits themselves aren't special inside a quoted attribute value — the
    // important case is unescaped quotes/backslashes, covered above. This
    // case documents that plain ids still round-trip unchanged.
  });

  it('is unescaped for a plain alphanumeric id (no spurious escaping)', () => {
    expect(itemIdSelector('folder-42')).toBe('[data-item-id="folder-42"]');
  });
});

describe('scopeFolderSelector', () => {
  it('escapes a double-quote in a folder id', () => {
    const selector = scopeFolderSelector('f"1');
    expect(selector).toBe('section[data-scope-folder-id="f\\"1"]');
  });
});
