/**
 * drop-resolution.ts — pure drop-target decision logic behind useDrag's
 * pointer handler. Tests are named after the user-visible behavior:
 *  - relocation drops (cross-parent) stay live under auto-sort; only
 *    same-parent reorder is gated to manual sort, and the drop indicator
 *    follows the same guard (isReorderDropAllowed).
 *  - workspace-bar gap insertion index is decided by pill midpoint, at the
 *    start/middle/end of the pill list.
 */
import { describe, expect, it } from 'vitest';
import {
  isInFolderDropZone,
  isNoopReorder,
  isPastMidpointX,
  isPastMidpointY,
  isReorderDropAllowed,
  nearestRowTile,
  reorderIndexFromHover,
  resolvePillGapDrop,
  resolveSectionDropTarget,
  type Rect,
  type SectionGeom,
  type TileGeom,
} from '@/newtab/lib/drop-resolution';

const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });

describe('isReorderDropAllowed — auto-sort gating', () => {
  it('allows a same-parent reorder under manual sort', () => {
    expect(isReorderDropAllowed('folderA', 'folderA', true)).toBe(true);
  });

  it('blocks a same-parent reorder under auto-sort (position is recomputed by the sort)', () => {
    expect(isReorderDropAllowed('folderA', 'folderA', false)).toBe(false);
  });

  it('allows a cross-parent relocation under auto-sort — moving into a different folder is valid in any sort mode', () => {
    expect(isReorderDropAllowed('folderB', 'folderA', false)).toBe(true);
  });

  it('allows a cross-parent relocation under manual sort too', () => {
    expect(isReorderDropAllowed('folderB', 'folderA', true)).toBe(true);
  });
});

describe('reorderIndexFromHover — reorder within the same list', () => {
  const orderedIds = ['a', 'b', 'c'];

  it('places before the hovered item when dropped on its leading half', () => {
    expect(reorderIndexFromHover(orderedIds, 'b', false)).toBe(1);
  });

  it('places after the hovered item when dropped on its trailing half', () => {
    expect(reorderIndexFromHover(orderedIds, 'b', true)).toBe(2);
  });

  it('moving an item down the list lands one past the target when placed after', () => {
    expect(reorderIndexFromHover(orderedIds, 'c', true)).toBe(3);
  });

  it('moving an item up the list lands at the target index when placed before', () => {
    expect(reorderIndexFromHover(orderedIds, 'a', false)).toBe(0);
  });

  it('falls back to the end of the list when the hovered id is not present (already filtered out)', () => {
    expect(reorderIndexFromHover(orderedIds, 'missing', false)).toBe(3);
  });
});

describe('isNoopReorder — no-op drop suppression', () => {
  it('suppresses when a single item is dropped back at its own post-removal slot in the same parent', () => {
    expect(isNoopReorder({ singleId: true, sameParent: true, dropIndex: 2, originIndex: 2 })).toBe(true);
  });

  it('does not suppress when the drop index actually differs from the origin index', () => {
    expect(isNoopReorder({ singleId: true, sameParent: true, dropIndex: 3, originIndex: 2 })).toBe(false);
  });

  it('does not suppress a multi-item drag even at the same index (batch drops always commit)', () => {
    expect(isNoopReorder({ singleId: false, sameParent: true, dropIndex: 2, originIndex: 2 })).toBe(false);
  });

  it('does not suppress a cross-parent drop even at a numerically equal index (it is a real relocation)', () => {
    expect(isNoopReorder({ singleId: true, sameParent: false, dropIndex: 2, originIndex: 2 })).toBe(false);
  });

  it('does not suppress when the dragged item was not found in the origin list', () => {
    expect(isNoopReorder({ singleId: true, sameParent: true, dropIndex: 0, originIndex: -1 })).toBe(false);
  });
});

describe('isInFolderDropZone — folder inside vs edge zone', () => {
  const folderRect = rect(0, 0, 100, 40);

  it('the middle band (25%-75%) is the "drop inside" zone', () => {
    expect(isInFolderDropZone(folderRect, 50)).toBe(true);
  });

  it('the left edge is a reorder zone, not inside', () => {
    expect(isInFolderDropZone(folderRect, 10)).toBe(false);
  });

  it('the right edge is a reorder zone, not inside', () => {
    expect(isInFolderDropZone(folderRect, 90)).toBe(false);
  });

  it('the exact 25% boundary counts as inside', () => {
    expect(isInFolderDropZone(folderRect, 25)).toBe(true);
  });

  it('the exact 75% boundary counts as inside', () => {
    expect(isInFolderDropZone(folderRect, 75)).toBe(true);
  });
});

describe('isPastMidpointX / isPastMidpointY', () => {
  it('a pointer left of center is not past the midpoint', () => {
    expect(isPastMidpointX(rect(0, 0, 100, 40), 40)).toBe(false);
  });

  it('a pointer right of center is past the midpoint', () => {
    expect(isPastMidpointX(rect(0, 0, 100, 40), 60)).toBe(true);
  });

  it('a pointer exactly on the midpoint is not "past" it (strict greater-than)', () => {
    expect(isPastMidpointX(rect(0, 0, 100, 40), 50)).toBe(false);
  });

  it('mirrors the same rule on the vertical axis', () => {
    expect(isPastMidpointY(rect(0, 0, 40, 100), 60)).toBe(true);
    expect(isPastMidpointY(rect(0, 0, 40, 100), 40)).toBe(false);
  });
});

describe('nearestRowTile — gap-snap fallback for tile-grid reorder', () => {
  const tiles: TileGeom[] = [
    { id: 'a', rect: rect(0, 0, 100, 100) },
    { id: 'b', rect: rect(100, 0, 100, 100) },
    { id: 'c', rect: rect(200, 0, 100, 100) },
  ];

  it('picks the tile whose row (vertical band) contains the pointer and whose center is nearest horizontally', () => {
    // Pointer sits in the gap just left of tile b's center — closer to b than a or c.
    expect(nearestRowTile(tiles, new Set(), 140, 50)).toBe('b');
  });

  it('excludes tiles in the drag set from consideration', () => {
    expect(nearestRowTile(tiles, new Set(['b']), 140, 50)).toBe('a');
  });

  it('returns null when the pointer is outside every tile row band (different vertical row)', () => {
    expect(nearestRowTile(tiles, new Set(), 140, 500)).toBeNull();
  });

  it('returns null when every eligible tile is excluded', () => {
    expect(nearestRowTile(tiles, new Set(['a', 'b', 'c']), 140, 50)).toBeNull();
  });
});

describe('resolveSectionDropTarget — section-drop nearest-neighbour resolution', () => {
  const sections: SectionGeom[] = [
    { id: 's1', rect: rect(0, 0, 300, 100) },
    { id: 's2', rect: rect(0, 120, 300, 100) },
    { id: 's3', rect: rect(0, 240, 300, 100) },
  ];

  it('a direct hit inside a section resolves to that section, before its midline', () => {
    expect(resolveSectionDropTarget(sections, new Set(), 30)).toEqual({ id: 's1', placeAfter: false });
  });

  it('a direct hit past a section midline places after it', () => {
    expect(resolveSectionDropTarget(sections, new Set(), 70)).toEqual({ id: 's1', placeAfter: true });
  });

  it('a drop in the gap between sections falls back to the nearest section by vertical distance', () => {
    // y=110 sits in the gap between s1 (ends at 100) and s2 (starts at 120) —
    // closer to s1's bottom edge (dist 10) than s2's top edge (dist 10)... use
    // an asymmetric point to make the nearest choice unambiguous.
    expect(resolveSectionDropTarget(sections, new Set(), 105)).toEqual({ id: 's1', placeAfter: true });
    expect(resolveSectionDropTarget(sections, new Set(), 115)).toEqual({ id: 's2', placeAfter: false });
  });

  it('excludes dragged sections from both the direct-hit and nearest-neighbour search', () => {
    // Dragging s1 itself: a pointer over s1's old rect must resolve to a
    // different section, not itself.
    expect(resolveSectionDropTarget(sections, new Set(['s1']), 30)).toEqual({ id: 's2', placeAfter: false });
  });

  it('returns null when every section is excluded (dragging the only section)', () => {
    expect(resolveSectionDropTarget([sections[0]!], new Set(['s1']), 30)).toBeNull();
  });
});

describe('resolvePillGapDrop — workspace-bar gap insertion index', () => {
  const pills: Rect[] = [
    rect(0, 0, 100, 40),
    rect(100, 0, 100, 40),
    rect(200, 0, 100, 40),
  ];

  it('inserts at the start when the pointer is left of the first pill center', () => {
    expect(resolvePillGapDrop(pills, 10)).toEqual({ insertIndex: 0, lineIndex: 0, linePos: 'before' });
  });

  it('inserts in the middle when the pointer sits between the first and second pill centers', () => {
    expect(resolvePillGapDrop(pills, 120)).toEqual({ insertIndex: 1, lineIndex: 1, linePos: 'before' });
  });

  it('inserts at the end when the pointer is right of the last pill center', () => {
    expect(resolvePillGapDrop(pills, 290)).toEqual({ insertIndex: 3, lineIndex: 2, linePos: 'after' });
  });

  it('with no pills, inserts at index 0 with no line to anchor', () => {
    expect(resolvePillGapDrop([], 50)).toEqual({ insertIndex: 0, lineIndex: null, linePos: 'after' });
  });

  it('TopNav\'s per-pill onDragOver reduces to the same function: hovering pill i and being left of its center is index i', () => {
    // TopNav calls resolvePillGapDrop([rect], pointerX) for whichever single
    // pill is under the native dragover, then adds that pill's own index i.
    const i = 1;
    const hoveredPillRect = pills[i]!;
    expect(i + resolvePillGapDrop([hoveredPillRect], 120).insertIndex).toBe(1);
  });

  it('TopNav\'s per-pill onDragOver: hovering pill i right of its center is index i + 1', () => {
    const i = 1;
    const hoveredPillRect = pills[i]!;
    expect(i + resolvePillGapDrop([hoveredPillRect], 180).insertIndex).toBe(2);
  });
});
