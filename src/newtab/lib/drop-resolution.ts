// Pure drop-target decision logic factored out of useDrag.ts's onMove pointer
// handler. Every function here takes plain geometry (ids, rects, pointer
// coordinates) — no DOM types, no side effects. useDrag.ts stays responsible
// for reading the DOM (elementFromPoint, closest, getBoundingClientRect,
// data-* attributes) into these shapes and for writing the resulting
// decision back onto the DOM/state; the decisions themselves live here so
// they're unit-testable without a browser.

// Plain stand-in for DOMRect — only the fields these decisions read.
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function midX(rect: Rect): number {
  return rect.left + rect.width / 2;
}

function midY(rect: Rect): number {
  return rect.top + rect.height / 2;
}

// A same-parent reorder is position-based, so it only makes sense under
// manual sort. A cross-parent drop (parentId differs from the drag's origin
// scope) is a relocation, not a reorder, and stays valid in every sort mode.
export function isReorderDropAllowed(parentId: string, originScopeId: string, reorderEnabled: boolean): boolean {
  const isRelocation = parentId !== originScopeId;
  return reorderEnabled || isRelocation;
}

// Position in an already-drag-set-filtered ordered id list where a hovered
// item's before/after edge places the drop. Falls back to the end of the
// list when the hovered id isn't present (already filtered out, or a
// section/backdrop append with no specific neighbor).
export function reorderIndexFromHover(orderedIds: string[], hoverId: string, placeAfter: boolean): number {
  const idx = orderedIds.indexOf(hoverId);
  return idx === -1 ? orderedIds.length : idx + (placeAfter ? 1 : 0);
}

// A computed reorder is a no-op when it would drop a single dragged item back
// at the slot it already occupies in the same parent — suppress the drop
// indicator and the eventual commit for that case.
export function isNoopReorder(params: {
  singleId: boolean;
  sameParent: boolean;
  dropIndex: number;
  originIndex: number;
}): boolean {
  if (!params.singleId || !params.sameParent) return false;
  if (params.originIndex === -1) return false;
  return params.dropIndex === params.originIndex;
}

// True when the pointer sits in a folder tile's middle band (25%-75% of its
// width) rather than its left/right edge — the zone that means "drop inside
// this folder" instead of "reorder before/after it".
export function isInFolderDropZone(rect: Rect, pointerX: number): boolean {
  const left = rect.left + rect.width * 0.25;
  const right = rect.left + rect.width * 0.75;
  return pointerX >= left && pointerX <= right;
}

export function isPastMidpointX(rect: Rect, pointerX: number): boolean {
  return pointerX > midX(rect);
}

export function isPastMidpointY(rect: Rect, pointerY: number): boolean {
  return pointerY > midY(rect);
}

export interface TileGeom {
  id: string;
  rect: Rect;
}

// Gap-snap fallback for tile-grid reorder: when the pointer isn't directly
// over a tile (it's in the gap between them), pick the nearest tile in the
// same row band by horizontal distance to its center. Returns null when no
// eligible (non-dragged) tile shares the pointer's row.
export function nearestRowTile(tiles: TileGeom[], dragSet: Set<string>, pointerX: number, pointerY: number): string | null {
  let best: { id: string; dx: number } | null = null;
  for (const t of tiles) {
    if (dragSet.has(t.id)) continue;
    const bottom = t.rect.top + t.rect.height;
    if (pointerY < t.rect.top || pointerY > bottom) continue;
    const dx = Math.abs(pointerX - midX(t.rect));
    if (!best || dx < best.dx) best = { id: t.id, dx };
  }
  return best?.id ?? null;
}

export interface SectionGeom {
  id: string;
  rect: Rect;
}

export interface SectionDropResolution {
  id: string;
  placeAfter: boolean;
}

// Section-list (root sections view) drop target: prefer the section the
// pointer is vertically inside; otherwise fall back to the section whose
// vertical center is nearest, so a drop in the gap between sections still
// resolves to a neighbor instead of doing nothing. Dragged sections
// themselves are never eligible targets. Returns null only when every
// section is excluded (e.g. dragging the sole section).
export function resolveSectionDropTarget(sections: SectionGeom[], dragSet: Set<string>, pointerY: number): SectionDropResolution | null {
  for (const sec of sections) {
    if (dragSet.has(sec.id)) continue;
    const bottom = sec.rect.top + sec.rect.height;
    if (pointerY >= sec.rect.top && pointerY <= bottom) {
      return { id: sec.id, placeAfter: isPastMidpointY(sec.rect, pointerY) };
    }
  }
  let best: { id: string; dy: number; placeAfter: boolean } | null = null;
  for (const sec of sections) {
    if (dragSet.has(sec.id)) continue;
    const dy = Math.abs(pointerY - midY(sec.rect));
    if (!best || dy < best.dy) best = { id: sec.id, dy, placeAfter: isPastMidpointY(sec.rect, pointerY) };
  }
  return best ? { id: best.id, placeAfter: best.placeAfter } : null;
}

export interface PillGapResolution {
  // Index in the ordered pill list where a new item should be inserted.
  insertIndex: number;
  // Index of the pill the insertion-line indicator should render on, or null
  // when there are no pills to anchor it to.
  lineIndex: number | null;
  linePos: 'before' | 'after';
}

// Shared by both drop interactions that insert something between workspace
// pills by comparing pointer-x to each pill's center: useDrag's bar-gap
// bookmark/folder drop (evaluated once against every pill) and TopNav's
// native-DnD pill-reorder drag (evaluated per-pill on hover, as a one-pill
// slice of the same walk — see TopNav.tsx's onDragOver).
export function resolvePillGapDrop(pillRects: Rect[], pointerX: number): PillGapResolution {
  for (let i = 0; i < pillRects.length; i++) {
    if (pointerX < midX(pillRects[i]!)) {
      return { insertIndex: i, lineIndex: i, linePos: 'before' };
    }
  }
  if (pillRects.length > 0) {
    return { insertIndex: pillRects.length, lineIndex: pillRects.length - 1, linePos: 'after' };
  }
  return { insertIndex: 0, lineIndex: null, linePos: 'after' };
}
