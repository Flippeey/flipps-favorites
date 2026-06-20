import { useEffect, useRef, useState, type RefObject } from 'react';

export type DropTarget =
  | { kind: 'reorder'; parentId: string; index: number }
  | { kind: 'folder'; folderId: string }
  | { kind: 'dock' }
  | { kind: 'workspace'; workspaceId: string }
  // insertIndex is the position in the ordered workspace list where the new
  // workspace will be inserted (0 = before first pill, workspaces.length = after last).
  | { kind: 'workspace-new'; insertIndex: number };

interface UseDragArgs {
  surface: HTMLElement | null;
  rootFolderId: string;
  enabled: boolean;
  // Reordering (positioning a tile between siblings) is only meaningful under
  // manual sort; under auto-sort it's suppressed while relocation drops (into a
  // folder, the dock, or another workspace) stay live. Distinct from `enabled`,
  // which gates the whole drag interaction.
  reorderEnabled: boolean;
  selectionRef: RefObject<{ ids: Set<string>; scopeFolderId: string }>;
  // Fetch the live ordered children for a folder id (after current sort).
  getOrderedChildren: (folderId: string) => Array<{ id: string }>;
  onCommit: (dragIds: string[], target: DropTarget) => void;
  onCancel?: () => void;
  // Fired once per drag when a reorder is attempted while reordering is disabled,
  // so the UI can explain that Manual sort is required.
  onReorderBlocked?: () => void;
  dragEngagedRef?: { current: boolean };
  // Spring-loaded workspace tabs: called once when the pointer hovers a workspace
  // tab for SPRING_DELAY_MS during a drag, so the user can open that workspace and
  // drop precisely instead of dumping the item into its root.
  onSpringOpenWorkspace?: (workspaceId: string) => void;
}

const DRAG_THRESHOLD = 6;
const SPRING_DELAY_MS = 900;

function closestScopeId(el: HTMLElement | null, rootFolderId: string): string {
  const scopeEl = el?.closest('[data-scope-folder-id]') as HTMLElement | null;
  return scopeEl?.dataset.scopeFolderId || rootFolderId;
}

export function clearDropAttrs({ includeSource }: { includeSource: boolean }): void {
  document.querySelectorAll<HTMLElement>('[data-item-id][data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  document.querySelectorAll<HTMLElement>('section[data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  if (includeSource) {
    document.querySelectorAll<HTMLElement>('[data-item-id][data-drag-source]').forEach(el => {
      delete el.dataset.dragSource;
    });
  }
  document.querySelectorAll<HTMLElement>('.ff-dock[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
  document.querySelectorAll<HTMLElement>('[data-overlay-crumb-id][data-drop-position]').forEach(el => {
    delete el.dataset.dropPosition;
  });
  document.querySelectorAll<HTMLElement>('.ff-folder-overlay[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
  document.querySelectorAll<HTMLElement>('.ff-sections[data-drop-target]').forEach(el => {
    delete el.dataset.dropTarget;
  });
  document.querySelectorAll<HTMLElement>('[data-workspace-id][data-drop-hover]').forEach(el => {
    delete el.dataset.dropHover;
  });
  // Workspace gap insertion-line indicators: reuse the same data-drop-before /
  // data-drop-after attributes that the pill tab-reorder drag already clears via
  // the HTML5 drag events. We must also clear them here for pointer-drag paths.
  document.querySelectorAll<HTMLElement>('[data-workspace-id][data-drop-before]').forEach(el => {
    delete el.dataset.dropBefore;
  });
  document.querySelectorAll<HTMLElement>('[data-workspace-id][data-drop-after]').forEach(el => {
    delete el.dataset.dropAfter;
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
  reorderEnabled,
  selectionRef,
  getOrderedChildren,
  onCommit,
  onCancel,
  onReorderBlocked,
  dragEngagedRef,
  onSpringOpenWorkspace,
}: UseDragArgs): DragPreviewState | null {
  const [preview, setPreview] = useState<DragPreviewState | null>(null);
  const stateRef = useRef<{
    active: boolean;
    engaged: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    dragIds: string[];
    dragKind: string;
    scopeId: string;
    dropTarget: DropTarget | null;
    dropOnBackdrop: boolean;
    tiles: HTMLElement[] | null;
    springWsId: string | null;
    springTimer: ReturnType<typeof setTimeout> | null;
    springFiredFor: string | null;
    sprung: boolean;
    reorderBlocked: boolean;
  } | null>(null);
  const rootFolderIdRef = useRef(rootFolderId);
  rootFolderIdRef.current = rootFolderId;
  const getOrderedChildrenRef = useRef(getOrderedChildren);
  getOrderedChildrenRef.current = getOrderedChildren;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const onSpringOpenWorkspaceRef = useRef(onSpringOpenWorkspace);
  onSpringOpenWorkspaceRef.current = onSpringOpenWorkspace;
  const reorderEnabledRef = useRef(reorderEnabled);
  reorderEnabledRef.current = reorderEnabled;
  const onReorderBlockedRef = useRef(onReorderBlocked);
  onReorderBlockedRef.current = onReorderBlocked;

  useEffect(() => {
    if (!enabled) return;
    const canvas = surface;
    if (!canvas) return;

    const cancel = () => {
      clearDropAttrs({ includeSource: true });
      setPreview(null);
      if (stateRef.current?.springTimer) clearTimeout(stateRef.current.springTimer);
      stateRef.current = null;
      onCancelRef.current?.();
    };

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      const tileEl = target.closest<HTMLElement>('[data-item-id]');
      if (!tileEl) return;
      const tileId = tileEl.dataset.itemId;
      if (!tileId) return;

      const scopeId = closestScopeId(tileEl, rootFolderIdRef.current);
      const sel = selectionRef.current;
      const dragIds = sel && sel.scopeFolderId === scopeId && sel.ids.has(tileId)
        ? Array.from(sel.ids)
        : [tileId];

      // Prevent browser text selection when dragging non-button elements (e.g. section headers)
      if (tileEl.tagName !== 'BUTTON') event.preventDefault();

      stateRef.current = {
        active: true,
        engaged: false,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragIds,
        dragKind: tileEl.dataset.itemKind ?? '',
        scopeId,
        dropTarget: null,
        dropOnBackdrop: false,
        tiles: null,
        springWsId: null,
        springTimer: null,
        springFiredFor: null,
        sprung: false,
        reorderBlocked: false,
      };
    };

    const onMove = (event: PointerEvent) => {
      const drag = stateRef.current;
      if (!drag || !drag.active) return;

      // Reorder is position-based, so it's only meaningful under manual sort.
      // When disabled, clear any reorder target and surface the reason once per
      // drag — relocation drops (folder/dock/workspace) are handled before any
      // reorder code runs, so they stay live regardless.
      const blockReorder = (): void => {
        drag.dropTarget = null;
        if (!drag.reorderBlocked) {
          drag.reorderBlocked = true;
          onReorderBlockedRef.current?.();
        }
      };
      const setReorder = (parentId: string, index: number, hint?: { el: HTMLElement; pos: 'before' | 'after' }): void => {
        // A "reorder" target whose parent differs from the drag's origin scope is
        // actually a relocation (moving into a different folder / the root) — valid
        // in any sort mode. Only a same-parent reorder is position-based and thus
        // gated to manual sort.
        const isRelocation = parentId !== drag.scopeId;
        if (!reorderEnabledRef.current && !isRelocation) { blockReorder(); return; }
        // Show the drop indicator whenever the drop is live — including an auto-sort
        // relocation, where it marks where the item lands before the sort settles it.
        if (hint) hint.el.dataset.dropPosition = hint.pos;
        drag.dropTarget = { kind: 'reorder', parentId, index };
      };

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.engaged) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.engaged = true;
        if (dragEngagedRef) dragEngagedRef.current = true;
        // Mark source tiles
        for (const id of drag.dragIds) {
          const el = canvas.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
          if (el) el.dataset.dragSource = 'true';
        }
        // Cache candidate tile list once per drag session (DOM is stable at engage time).
        // Reused by the gap-snap fallback on every pointermove to avoid repeated querySelectorAll.
        drag.tiles = Array.from(canvas.querySelectorAll<HTMLElement>('[data-item-id]:not([data-item-kind="section"])'));
      }

      // A spring-load workspace switch rebuilds the canvas; the cached tile list is
      // nulled on switch so the gap-snap fallback re-reads the new workspace's tiles.
      if (drag.engaged && !drag.tiles) {
        drag.tiles = Array.from(canvas.querySelectorAll<HTMLElement>('[data-item-id]:not([data-item-kind="section"])'));
      }

      setPreview({ ids: drag.dragIds, x: event.clientX, y: event.clientY });
      clearDropAttrs({ includeSource: false });

      const dragSet = new Set(drag.dragIds);
      const elementUnder = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      drag.dropOnBackdrop = false;

      // Spring-loaded workspace tabs: hovering a tab for SPRING_DELAY_MS opens that
      // workspace mid-drag. Use a real timer (not elapsed-time checked per move) so it
      // fires even when the pointer is held still over the tab. Entering a different
      // target (another tab, the dock, a folder, empty space) cancels the pending timer.
      if (onSpringOpenWorkspaceRef.current) {
        const springWsId = elementUnder?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId || null;
        if (springWsId !== drag.springWsId) {
          if (drag.springTimer) { clearTimeout(drag.springTimer); drag.springTimer = null; }
          drag.springWsId = springWsId;
          if (springWsId !== drag.springFiredFor) drag.springFiredFor = null;
          if (springWsId && drag.springFiredFor !== springWsId) {
            drag.springTimer = setTimeout(() => {
              const d = stateRef.current;
              if (!d || !d.active || d.springWsId !== springWsId || d.springFiredFor === springWsId) return;
              d.springTimer = null;
              d.springFiredFor = springWsId;
              d.sprung = true;
              d.tiles = null;
              onSpringOpenWorkspaceRef.current?.(springWsId);
            }, SPRING_DELAY_MS);
          }
        }
      }
      const dockEl = elementUnder?.closest('.ff-dock') as HTMLElement | null;
      if (dockEl && dockEl.dataset.scopeFolderId !== drag.scopeId) {
        const dockFolderTile = elementUnder?.closest<HTMLElement>('[data-item-id][data-item-kind="folder"]');
        if (dockFolderTile && dockEl.contains(dockFolderTile)) {
          const folderId = dockFolderTile.dataset.itemId ?? '';
          if (folderId && !dragSet.has(folderId)) {
            dockFolderTile.dataset.dropPosition = 'inside';
            drag.dropTarget = { kind: 'folder', folderId };
            return;
          }
        }
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

      // Workspace tab drop target: pill check MUST precede bar-gap check.
      const wsTabEl = elementUnder?.closest<HTMLElement>('[data-workspace-id]');
      if (wsTabEl) {
        const workspaceId = wsTabEl.dataset.workspaceId ?? '';
        if (workspaceId) {
          wsTabEl.dataset.dropHover = 'true';
          drag.dropTarget = { kind: 'workspace', workspaceId };
          return;
        }
      }

      // Bar-gap drop target: pointer is over the workspace bar container but NOT
      // on any pill. Compute the insertion index by comparing pointer-x to each
      // pill's midpoint — same logic useDragWiring's commit handler uses for
      // workspace reorder. Render the vertical insertion line on the adjacent pill
      // using data-drop-before / data-drop-after, which already have CSS in nav.css
      // (.ff-ws-tab[data-drop-before]::before / [data-drop-after]::after) from the
      // HTML5 workspace tab-reorder interaction — we reuse exactly that pattern.
      const dropZoneEl = elementUnder?.closest<HTMLElement>('[data-workspace-drop-zone]');
      if (dropZoneEl) {
        const pills = Array.from(
          dropZoneEl.querySelectorAll<HTMLElement>('[data-workspace-id]')
        );
        // Determine insert index: walk pills left-to-right, insert before the first
        // pill whose center-x is to the right of the pointer. If pointer is past all
        // pills, insert at the end.
        let insertIndex = pills.length; // default: after last pill
        let lineTarget: HTMLElement | null = null;
        let linePos: 'before' | 'after' = 'after';
        for (let i = 0; i < pills.length; i++) {
          const r = pills[i]!.getBoundingClientRect();
          const midX = r.left + r.width / 2;
          if (event.clientX < midX) {
            insertIndex = i;
            lineTarget = pills[i]!;
            linePos = 'before';
            break;
          }
        }
        if (lineTarget === null && pills.length > 0) {
          // Pointer is right of all pill centers → insert after the last pill.
          lineTarget = pills[pills.length - 1]!;
          linePos = 'after';
        }
        if (lineTarget) {
          lineTarget.dataset[linePos === 'before' ? 'dropBefore' : 'dropAfter'] = 'true';
        }
        drag.dropTarget = { kind: 'workspace-new', insertIndex };
        return;
      }

      if (drag.dragKind === 'section') {
        const sectionEls = Array.from(
          canvas.querySelectorAll<HTMLElement>('section[data-scope-folder-id]')
        );
        let targetSectionId: string | null = null;
        let placeAfter = false;

        for (const sec of sectionEls) {
          const id = sec.dataset.scopeFolderId ?? '';
          if (dragSet.has(id)) continue;
          const r = sec.getBoundingClientRect();
          if (event.clientY >= r.top && event.clientY <= r.bottom) {
            targetSectionId = id;
            placeAfter = event.clientY > r.top + r.height / 2;
            break;
          }
        }

        if (!targetSectionId) {
          let best: { id: string; dy: number; placeAfter: boolean } | null = null;
          for (const sec of sectionEls) {
            const id = sec.dataset.scopeFolderId ?? '';
            if (dragSet.has(id)) continue;
            const r = sec.getBoundingClientRect();
            const dy = Math.abs(event.clientY - (r.top + r.height / 2));
            if (!best || dy < best.dy) best = { id, dy, placeAfter: event.clientY > r.top + r.height / 2 };
          }
          if (best) { targetSectionId = best.id; placeAfter = best.placeAfter; }
        }

        if (!targetSectionId) {
          const ordered = getOrderedChildrenRef.current(rootFolderIdRef.current).filter(c => !dragSet.has(c.id));
          setReorder(rootFolderIdRef.current, ordered.length);
          return;
        }

        const ordered = getOrderedChildrenRef.current(rootFolderIdRef.current).filter(c => !dragSet.has(c.id));
        const idx = ordered.findIndex(c => c.id === targetSectionId);
        const dropIndex = idx === -1 ? ordered.length : idx + (placeAfter ? 1 : 0);

        if (drag.dragIds.length === 1) {
          const unfiltered = getOrderedChildrenRef.current(rootFolderIdRef.current);
          const origIdx = unfiltered.findIndex(c => c.id === drag.dragIds[0]);
          if (origIdx !== -1 && dropIndex === origIdx) { drag.dropTarget = null; return; }
        }

        const targetSec = canvas.querySelector<HTMLElement>(`section[data-scope-folder-id="${targetSectionId}"]`);
        setReorder(rootFolderIdRef.current, dropIndex, targetSec ? { el: targetSec, pos: placeAfter ? 'after' : 'before' } : undefined);
        return;
      }

      let hoverTile = elementUnder?.closest<HTMLElement>('[data-item-id]:not([data-item-kind="section"])') ?? null;
      let directHit = Boolean(hoverTile);
      if (!hoverTile) {
        // Expand hit zone: pick nearest tile in the same row band so gaps between
        // tiles still register as a "before/after neighbor" drop target.
        // Use the per-session cached tile list (populated at engage time) to avoid
        // repeated querySelectorAll on every pointermove.
        const tiles = drag.tiles ?? [];
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
        const sectionEl = elementUnder?.closest<HTMLElement>('section[data-scope-folder-id]');
        if (sectionEl && drag.dragKind !== 'section') {
          const folderId = sectionEl.dataset.scopeFolderId ?? '';
          if (folderId && !dragSet.has(folderId)) {
            sectionEl.dataset.dropPosition = 'inside';
            drag.dropTarget = { kind: 'folder', folderId };
            return;
          }
        }
        // Sections-view backdrop: outside all tiles/sections → append to root
        // (mirrors folder-overlay backdrop behaviour)
        const sectionsEl = canvas?.querySelector<HTMLElement>('.ff-sections');
        if (sectionsEl && drag.dragKind !== 'section') {
          const ordered = getOrderedChildrenRef.current(rootFolderIdRef.current).filter(c => !dragSet.has(c.id));
          // Highlight when the drop is live: a manual-sort append, or (under
          // auto-sort) a relocation of an item dragged out of a folder into root.
          if (reorderEnabledRef.current || rootFolderIdRef.current !== drag.scopeId) {
            sectionsEl.dataset.dropTarget = 'true';
          }
          setReorder(rootFolderIdRef.current, ordered.length);
          return;
        }
        // After a spring switch the dragged items still live in the old scope; an
        // empty-area drop should land in the now-active workspace root, not the origin.
        const fallbackScope = drag.sprung ? rootFolderIdRef.current : drag.scopeId;
        const ordered = getOrderedChildrenRef.current(fallbackScope).filter(c => !dragSet.has(c.id));
        setReorder(fallbackScope, ordered.length);
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

      setReorder(hoverScope, dropIndex, { el: hoverTile, pos: placeAfter ? 'after' : 'before' });
    };

    const onUp = (event: PointerEvent) => {
      const drag = stateRef.current;
      if (!drag || !drag.active) return;
      const target = drag.dropTarget;
      const ids = drag.dragIds;
      const engaged = drag.engaged;
      const dropOnBackdrop = drag.dropOnBackdrop;
      if (drag.springTimer) clearTimeout(drag.springTimer);
      clearDropAttrs({ includeSource: true });
      setPreview(null);
      stateRef.current = null;
      if (dragEngagedRef) setTimeout(() => { dragEngagedRef.current = false; });
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
      if (stateRef.current?.springTimer) clearTimeout(stateRef.current.springTimer);
      // Clear any stale drag-source / drop-indicator attributes left on the DOM.
      // Without this, an in-flight drag whose effect re-runs (surface change,
      // unmount, or dependency update) leaves tiles with data-drag-source="true"
      // → they render at 0.35 opacity ("muted favicons" bug).
      clearDropAttrs({ includeSource: true });
      setPreview(null);
      if (dragEngagedRef) dragEngagedRef.current = false;
      stateRef.current = null;
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [surface, enabled, selectionRef]);

  return preview;
}
