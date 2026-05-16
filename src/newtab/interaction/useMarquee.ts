import { useEffect, useRef, useState, type RefObject } from 'react';

export interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MarqueeSelection {
  ids: Set<string>;
  scopeFolderId: string;
}

interface UseMarqueeArgs {
  canvasRef: RefObject<HTMLElement | null>;
  rootFolderId: string;
  enabled: boolean;
  selectionRef: RefObject<MarqueeSelection>;
  onSelect: (next: MarqueeSelection) => void;
}

function closestScopeId(el: HTMLElement | null, fallback: string): string {
  const scopeEl = el?.closest('[data-scope-folder-id]') as HTMLElement | null;
  return scopeEl?.dataset.scopeFolderId || fallback;
}

function rectsIntersect(a: DOMRect, b: { left: number; right: number; top: number; bottom: number }): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

export function useMarquee({ canvasRef, rootFolderId, enabled, selectionRef, onSelect }: UseMarqueeArgs): MarqueeRect | null {
  const [rect, setRect] = useState<MarqueeRect | null>(null);
  const stateRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    scopeId: string;
    baseIds: Set<string>;
    additive: boolean;
  } | null>(null);
  const rootFolderIdRef = useRef(rootFolderId);
  rootFolderIdRef.current = rootFolderId;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest('.ff-tile') || target.closest('button')) return;
      const scopeId = closestScopeId(target, rootFolderIdRef.current);
      const additive = event.shiftKey;
      const current = selectionRef.current;
      const baseIds: Set<string> = additive && current && current.scopeFolderId === scopeId
        ? new Set(current.ids)
        : new Set();

      if (!additive) {
        onSelectRef.current({ ids: new Set(), scopeFolderId: scopeId });
      }

      stateRef.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scopeId,
        baseIds,
        additive,
      };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* noop */ }
      event.preventDefault();
    };

    const onMove = (event: PointerEvent) => {
      const drag = stateRef.current;
      if (!drag || !drag.active) return;
      const left = Math.min(drag.startX, event.clientX);
      const right = Math.max(drag.startX, event.clientX);
      const top = Math.min(drag.startY, event.clientY);
      const bottom = Math.max(drag.startY, event.clientY);
      const canvasRect = canvas.getBoundingClientRect();
      setRect({
        left: left - canvasRect.left,
        top: top - canvasRect.top,
        width: right - left,
        height: bottom - top,
      });

      const tiles = canvas.querySelectorAll<HTMLElement>('.ff-tile[data-item-id]');
      const next = new Set(drag.baseIds);
      tiles.forEach(t => {
        const tileScope = closestScopeId(t, rootFolderIdRef.current);
        if (tileScope !== drag.scopeId) return;
        if (!rectsIntersect(t.getBoundingClientRect(), { left, right, top, bottom })) return;
        const id = t.dataset.itemId;
        if (id) next.add(id);
      });
      onSelectRef.current({ ids: next, scopeFolderId: drag.scopeId });
    };

    const finish = (event: PointerEvent) => {
      const drag = stateRef.current;
      if (!drag || !drag.active) return;
      drag.active = false;
      setRect(null);
      try { canvas.releasePointerCapture(event.pointerId); } catch { /* noop */ }
      stateRef.current = null;
    };

    canvas.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [canvasRef, enabled, selectionRef]);

  return rect;
}
