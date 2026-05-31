import { useEffect } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import type { ContextMenuItem } from '../components/ContextMenu';
import { isFolder } from '../lib/tree';

interface UseKeyboardNavArgs {
  enabled: boolean;
  navItems: BookmarkNode[];
  focusedTileId: string | null;
  setFocusedTileId: (id: string | null) => void;
  canvasEl: HTMLElement | null;
  onPickFolder: (folder: BookmarkNode) => void;
  onPickBookmark: (item: BookmarkNode, event?: { metaKey?: boolean; ctrlKey?: boolean }) => void;
  buildContextMenuItems: (target: BookmarkNode | null) => ContextMenuItem[];
  setContextMenu: (menu: { x: number; y: number; items: ContextMenuItem[] }) => void;
}

// Arrow-key grid navigation. Active only when no dialog/overlay/input has focus —
// otherwise we'd hijack typing or contend with active surfaces.
export function useKeyboardNav({
  enabled,
  navItems,
  focusedTileId,
  setFocusedTileId,
  canvasEl,
  onPickFolder,
  onPickBookmark,
  buildContextMenuItems,
  setContextMenu,
}: UseKeyboardNavArgs): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      if (navItems.length === 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const idx = focusedTileId ? navItems.findIndex(n => n.id === focusedTileId) : -1;
      const isArrow = e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown';

      if (isArrow) {
        e.preventDefault();
        if (idx < 0) {
          setFocusedTileId(navItems[0].id);
          return;
        }
        // Column count read from the first .ff-grid inside the canvas — matches whatever
        // layout the active view rendered (tiles or sections).
        const grid = canvasEl?.querySelector<HTMLElement>('.ff-grid');
        const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 1;
        let next = idx;
        if (e.key === 'ArrowRight') next = Math.min(idx + 1, navItems.length - 1);
        else if (e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
        else if (e.key === 'ArrowDown') next = Math.min(idx + cols, navItems.length - 1);
        else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
        if (next !== idx) setFocusedTileId(navItems[next].id);
        return;
      }

      if (idx < 0) return;
      const item = navItems[idx];

      if (e.key === 'Enter') {
        e.preventDefault();
        if (isFolder(item)) onPickFolder(item);
        else onPickBookmark(item, { metaKey: false, ctrlKey: false });
        return;
      }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const el = canvasEl?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(item.id)}"]`);
        if (el) {
          const rect = el.getBoundingClientRect();
          setContextMenu({ x: rect.left + rect.width / 2, y: rect.bottom, items: buildContextMenuItems(item) });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, navItems, focusedTileId, setFocusedTileId, canvasEl, onPickFolder, onPickBookmark, buildContextMenuItems, setContextMenu]);
}

interface UseDeleteShortcutArgs {
  enabled: boolean;
  selection: { ids: Set<string> };
  focusedTileId: string | null;
  navItems: BookmarkNode[];
  onBatchDelete: (ids: string[]) => void;
  onDeleteFocused: (item: BookmarkNode) => void;
}

export function useDeleteShortcut({
  enabled,
  selection,
  focusedTileId,
  navItems,
  onBatchDelete,
  onDeleteFocused,
}: UseDeleteShortcutArgs): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      e.preventDefault();
      if (selection.ids.size > 1) {
        onBatchDelete(Array.from(selection.ids));
      } else if (selection.ids.size === 1) {
        const id = Array.from(selection.ids)[0];
        const item = navItems.find(n => n.id === id);
        if (item) onDeleteFocused(item);
      } else if (focusedTileId) {
        const item = navItems.find(n => n.id === focusedTileId);
        if (item) onDeleteFocused(item);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, selection, focusedTileId, navItems, onBatchDelete, onDeleteFocused]);
}
