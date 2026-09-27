import { describe, expect, it } from 'vitest';
import { computeBookmarkMoveIndex } from '@/background/move-index';

// WHY THIS FILE EXISTS
// bookmarks.move applies a same-parent reorder against the list AFTER the
// dragged item is removed, so a naive "drop at index N" request lands one
// slot early whenever the drop target is below the item's current position.
// This is the index math behind that compensation, isolated from
// extensionApi so it can be exercised directly instead of only through a
// live browser E2E drag.

describe('computeBookmarkMoveIndex', () => {
  // WHY: dragging a bookmark further down its own folder is the case the
  // compensation exists for — without the +1 the item would land one slot
  // short of where it was dropped.
  it('bumps the index by 1 when moving down within the same parent', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: 3,
      targetParentId: 'dock',
      currentParentId: 'dock',
      currentIndex: 1,
    })).toBe(4);
  });

  // WHY: dragging upward needs no compensation — the removal-then-insert
  // quirk only shifts items that sat AFTER the original position.
  it('leaves the index unchanged when moving up within the same parent', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: 0,
      targetParentId: 'dock',
      currentParentId: 'dock',
      currentIndex: 3,
    })).toBe(0);
  });

  // WHY: a drop at the item's own current index is a no-op reorder, not a
  // "moving down" gesture — greater-than, not greater-or-equal, is the
  // correct boundary.
  it('leaves the index unchanged when the requested index equals the current index', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: 2,
      targetParentId: 'dock',
      currentParentId: 'dock',
      currentIndex: 2,
    })).toBe(2);
  });

  // WHY: the very next slot down is the smallest case where the removal
  // shift actually matters — an off-by-one here would silently no-op every
  // "move one slot down" drag.
  it('bumps the index at the boundary of one slot past the current index', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: 3,
      targetParentId: 'dock',
      currentParentId: 'dock',
      currentIndex: 2,
    })).toBe(4);
  });

  // WHY: the removal-shift quirk is specific to reordering within the SAME
  // folder — a cross-folder move must never apply it, or an item dragged
  // into a new folder lands one slot too deep.
  it('leaves the index unchanged when moving to a different parent', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: 5,
      targetParentId: 'work',
      currentParentId: 'dock',
      currentIndex: 1,
    })).toBe(5);
  });

  // WHY: moveBookmark treats a missing index as "append" — compensation must
  // pass that through untouched rather than coercing it to a number.
  it('passes through an undefined requested index unchanged', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: undefined,
      targetParentId: 'dock',
      currentParentId: 'dock',
      currentIndex: 1,
    })).toBeUndefined();
  });

  // WHY: the caller only has a current position once bookmarks.get resolves
  // it; if that lookup came back without an index (or without a parent),
  // there is nothing safe to compensate against.
  it('leaves the index unchanged when the current position is unknown', () => {
    expect(computeBookmarkMoveIndex({
      requestedIndex: 3,
      targetParentId: 'dock',
      currentParentId: undefined,
      currentIndex: undefined,
    })).toBe(3);
  });
});
