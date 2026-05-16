import { useEffect, useRef, useState, type RefObject } from 'react';

export type DropTarget =
  | { kind: 'reorder'; parentId: string; index: number }
  | { kind: 'folder'; folderId: string }
  | { kind: 'dock' };

interface UseDragArgs {
  surface: HTMLElement | null;
  rootFolderId: string;
  enabled: boolean;
  selectionRef: RefObject<{ ids: Set<string>; scopeFolderId: string }>;
  // Fetch the live ordered children for a folder id (after current sort).
  getOrderedChildren: (folderId: string) => Array<{ id: string }>;
  onCommit: (dragIds: string[], target: DropTarget) => void;
  onCancel?: () => void;
}

const DRAG_THRESHOLD = 6;

function closestScopeId(el: HTMLElement | null, rootFolderId: string): string {
  const scopeEl = el?.closest('[data-scope-folder-id]') as HTMLElement | null;
  return scopeEl?.dataset.scopeFolderId || rootFolderId;
}

function clearDropAttrs(): void {
  document.querySelectorAll<HTMLElement>('.ff-tile[data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  document.querySelectorAll<HTMLElement>('.ff-tile[data-drag-source]').forEach(el => {
    delete el.dataset.dragSource;
  });
  document.querySelectorAll<HTMLElement>('.ff-dock[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
  document.querySelectorAll<HTMLElement>('[data-overlay-crumb-id][data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  document.querySelectorAll<HTMLElement>('.ff-folder-overlay[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
}

export interface DragPreviewState {
  ids: string[];
  x: number;
  y: number;
}

export function useDrag({
  surface,
  rootFolderId,
  enabled,
  selectionRef,
  getOrderedChildren,
  onCommit,
  onCancel,
}: UseDragArgs): DragPreviewState | null {
  const [preview, setPreview] = useState<DragPreviewState | null>(null);
  const stateRef = useRef<{
    active: boolean;
    engaged: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    dragIds: string[];
    scopeId: string;
    dropTarget: DropTarget | null;
    dropOnBackdrop: boolean;
  } | null>(null);
  const rootFolderIdRef = useRef(rootFolderId);
  rootFolderIdRef.current = rootFolderId;
  const getOrderedChildrenRef = useRef(getOrderedChildren);
  getOrderedChildrenRef.current = getOrderedChildren;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!enabled) return;
    const canvas = surface;
    if (!canvas) return;

    const cancel = () => {
      clearDropAttrs();
      setPreview(null);
      stateRef.current = null;
      onCancelRef.current?.();
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const tileEl = target.closest<HTMLElement>('.ff-tile[data-item-id]');
      if (!tileEl) return;
      const tileId = tileEl.dataset.itemId;
      if (!tileId) return;

      const scopeId = closestScopeId(tileEl, rootFolderIdRef.current);
      const sel = selectionRef.current;
      const dragIds = sel && sel.scopeFolderId === scopeId && sel.ids.has(tileId)
        ? Array.from(sel.ids)
        : [tileId];

      stateRef.current = {
        active: true,
        engaged: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragIds,
        scopeId,
        dropTarget: null,
        dropOnBackdrop: false,
      };
    };

    const onMove = (event: PointerEvent) => {
      const drag = stateRef.current;
      if (!drag || !drag.active) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.engaged) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.engaged = true;
        // Mark source tiles
        for (const id of drag.dragIds) {
          const el = canvas.querySelector<HTMLElement>(`.ff-tile[data-item-id="${id}"]`);
          if (el) el.dataset.dragSource = 'true';
        }
      }

      setPreview({ ids: drag.dragIds, x: event.clientX, y: event.clientY });
      clearDropPositionAttrs();

      const dragSet = new Set(drag.dragIds);
      const elementUnder = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      drag.dropOnBackdrop = false;
      const dockEl = elementUnder?.closest('.ff-dock') as HTMLElement | null;
      if (dockEl) {
        dockEl.dataset.dropTarget = 'true';
        drag.dropTarget = { kind: 'dock' };
        return;
      }

      // Breadcrumb drop target (overlay only)
      const crumbEl = elementUnder?.closest<HTMLElement>('[data-overlay-crumb-id]');
      if (crumbEl) {
        const folderId = crumbEl.dataset.overlayCrumbId ?? '';
        if (folderId && folderId !== drag.scopeId) {
          crumbEl.dataset.dropPosition = 'inside';
          drag.dropTarget = { kind: 'folder', folderId };
          return;
        }
        drag.dropTarget = null;
        return;
      }

      // Backdrop drop target → workspace root
      const overlayBackdrop = elementUnder?.closest<HTMLElement>('.ff-folder-overlay');
      const overCard = elementUnder?.closest<HTMLElement>('.ff-folder-overlay__card');
      if (overlayBackdrop && !overCard) {
        const rootId = overlayBackdrop.dataset.overlayRootId ?? rootFolderIdRef.current;
        if (rootId && rootId !== drag.scopeId) {
          overlayBackdrop.dataset.dropTarget = 'true';
          drag.dropTarget = { kind: 'folder', folderId: rootId };
          drag.dropOnBackdrop = true;
          return;
        }
        drag.dropTarget = null;
        return;
      }

      let hoverTile = elementUnder?.closest<HTMLElement>('.ff-tile[data-item-id]') ?? null;
      let directHit = Boolean(hoverTile);
      if (!hoverTile) {
        // Expand hit zone: pick nearest tile in the same row band so gaps between
        // tiles still register as a "before/after neighbor" drop target.
        const tiles = canvas.querySelectorAll<HTMLElement>('.ff-tile[data-item-id]');
        let best: { tile: HTMLElement; dx: number } | null = null;
        for (const t of tiles) {
          const id = t.dataset.itemId ?? '';
          if (dragSet.has(id)) continue;
          const r = t.getBoundingClientRect();
          if (event.clientY < r.top || event.clientY > r.bottom) continue;
          const center = r.left + r.width / 2;
          const dx = Math.abs(event.clientX - center);
          if (!best || dx < best.dx) best = { tile: t, dx };
        }
        hoverTile = best?.tile ?? null;
      }

      if (!hoverTile) {
        const ordered = getOrderedChildrenRef.current(drag.scopeId).filter(c => !dragSet.has(c.id));
        drag.dropTarget = { kind: 'reorder', parentId: drag.scopeId, index: ordered.length };
        return;
      }

      const hoverId = hoverTile.dataset.itemId ?? '';
      if (dragSet.has(hoverId)) {
        drag.dropTarget = null;
        return;
      }

      const hoverScope = closestScopeId(hoverTile, rootFolderIdRef.current);
      const hoverKind = hoverTile.dataset.itemKind;
      const rect = hoverTile.getBoundingClientRect();

      // Only treat as "drop inside folder" when cursor is directly over the folder
      // tile's middle band — never when we snapped from a gap.
      if (directHit && hoverKind === 'folder') {
        const inSideZone = event.clientX < rect.left + rect.width * 0.25 || event.clientX > rect.left + rect.width * 0.75;
        if (!inSideZone) {
          hoverTile.dataset.dropPosition = 'inside';
          drag.dropTarget = { kind: 'folder', folderId: hoverId };
          return;
        }
      }

      const placeAfter = event.clientX > rect.left + rect.width / 2;
      const ordered = getOrderedChildrenRef.current(hoverScope).filter(c => !dragSet.has(c.id));
      const idx = ordered.findIndex(c => c.id === hoverId);
      const dropIndex = idx === -1 ? ordered.length : idx + (placeAfter ? 1 : 0);

      // Suppress hint + commit when the computed reorder would not actually move
      // the item (dropping at its current post-removal slot in the same parent).
      if (drag.dragIds.length === 1 && hoverScope === drag.scopeId) {
        const unfiltered = getOrderedChildrenRef.current(drag.scopeId);
        const origIdx = unfiltered.findIndex(c => c.id === drag.dragIds[0]);
        if (origIdx !== -1 && dropIndex === origIdx) {
          drag.dropTarget = null;
          return;
        }
      }

      hoverTile.dataset.dropPosition = placeAfter ? 'after' : 'before';
      drag.dropTarget = { kind: 'reorder', parentId: hoverScope, index: dropIndex };
    };

    const onUp = (event: PointerEvent) => {
      const drag = stateRef.current;
      if (!drag || !drag.active) return;
      const target = drag.dropTarget;
      const ids = drag.dragIds;
      const engaged = drag.engaged;
      const dropOnBackdrop = drag.dropOnBackdrop;
      clearDropAttrs();
      setPreview(null);
      stateRef.current = null;
      if (engaged && target) {
        if (dropOnBackdrop) {
          window.dispatchEvent(new CustomEvent('ff-suppress-overlay-close'));
        }
        onCommitRef.current(ids, target);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stateRef.current?.active) {
        cancel();
      }
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKey);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [surface, enabled, selectionRef]);

  return preview;
}

function clearDropPositionAttrs(): void {
  document.querySelectorAll<HTMLElement>('.ff-tile[data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  document.querySelectorAll<HTMLElement>('.ff-dock[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
  document.querySelectorAll<HTMLElement>('[data-overlay-crumb-id][data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  document.querySelectorAll<HTMLElement>('.ff-folder-overlay[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
}
