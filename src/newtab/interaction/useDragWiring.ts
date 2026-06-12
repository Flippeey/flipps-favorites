import { useCallback } from 'react';
import type { AppSettings, BookmarkNode, BookmarkSortMode, WorkspaceRecord } from '@/shared/messages';
import type { PushToastInput } from '../state/useToasts';
import type { MarqueeSelection } from './useMarquee';
import { useDrag, type DropTarget, type DragPreviewState } from './useDrag';
import { moveBookmark } from '../lib/messaging';
import { findFolder } from '../lib/tree';
import { captureMoveSnapshots, restoreMoveSnapshots } from '../lib/move-snapshot';

interface UseDragWiringArgs {
  canvasEl: HTMLElement | null;
  overlayBodyEl: HTMLElement | null;
  dockEl: HTMLElement | null;
  rootFolder: BookmarkNode | null;
  settings: AppSettings;
  // Effective sort mode of the active workspace (per-workspace identity). Gates
  // reordering — App derives it from activeWorkspace, so the hook never reads it
  // off settings.
  bookmarkSortMode: BookmarkSortMode;
  workspaces: WorkspaceRecord[];
  tree: BookmarkNode[];
  sortedChildren: (children?: BookmarkNode[]) => BookmarkNode[];
  selectionRef: React.RefObject<MarqueeSelection>;
  setSelection: React.Dispatch<React.SetStateAction<MarqueeSelection>>;
  refreshTree: () => Promise<void>;
  dragEngagedRef: React.RefObject<boolean>;
  onSwitchWorkspace: (id: string) => void;
  // Surfaced once per drag when a reorder is attempted under a non-manual sort.
  onReorderBlocked: () => void;
  // Pushes the post-relocate "Moved …" toast carrying an Undo action.
  pushToast: (input: PushToastInput) => void;
}

interface UseDragWiringResult {
  dragPreview: DragPreviewState | null;
  dragEnabled: boolean;
}

// Wires the three drag surfaces (canvas, folder overlay, dock) to a single
// commit handler. Pure relocation of App.tsx's drag orchestration — behavior
// unchanged. Returns whichever surface currently has an active preview.
export function useDragWiring(args: UseDragWiringArgs): UseDragWiringResult {
  const {
    canvasEl, overlayBodyEl, dockEl, rootFolder, settings, bookmarkSortMode, workspaces, tree,
    sortedChildren, selectionRef, setSelection, refreshTree, dragEngagedRef,
    onSwitchWorkspace, onReorderBlocked, pushToast,
  } = args;

  // Spring-loaded tabs: open the hovered workspace mid-drag (skip if already active).
  const handleSpringOpenWorkspace = useCallback((id: string) => {
    if (id !== settings.activeWorkspaceId) onSwitchWorkspace(id);
  }, [onSwitchWorkspace, settings.activeWorkspaceId]);

  const getOrderedChildren = useCallback((folderId: string): Array<{ id: string }> => {
    const folder = findFolder(tree, folderId);
    return sortedChildren(folder?.children).map(c => ({ id: c.id }));
  }, [tree, sortedChildren]);

  const handleDragCommit = useCallback(async (dragIds: string[], target: DropTarget) => {
    // Snapshot every drag's origins from the live tree BEFORE moving so Undo can
    // replay each item back to its parent + index. We snapshot unconditionally —
    // not just for folder/dock/workspace drops — because a 'reorder' drop whose
    // target parent differs from an item's source folder is itself a cross-folder
    // relocation (e.g. list view: dropping next to a bookmark already inside a
    // folder). The `relocated` filter below keeps pure same-parent reorders
    // toast-free, so this stays correct for both cases.
    const snapshots = captureMoveSnapshots(tree, dragIds);
    try {
      if (target.kind === 'folder') {
        for (const id of dragIds) {
          await moveBookmark(id, target.folderId);
        }
      } else if (target.kind === 'dock') {
        const dockFolderId = settings.dockFolderId || rootFolder?.id || '';
        if (!dockFolderId) return;
        for (const id of dragIds) {
          await moveBookmark(id, dockFolderId);
        }
      } else if (target.kind === 'workspace') {
        const ws = workspaces.find(w => w.id === target.workspaceId);
        if (!ws) return;
        if (ws.rootFolderId === rootFolder?.id) return;
        for (const id of dragIds) {
          await moveBookmark(id, ws.rootFolderId);
        }
      } else {
        // reorder — preserve drag-source order, increment index as we go for items moving forward in same parent
        let idx = target.index;
        for (const id of dragIds) {
          await moveBookmark(id, target.parentId, idx);
          idx += 1;
        }
      }
      // Drop selection scope if target moved away
      const moveTargetScope = target.kind === 'folder' ? target.folderId : target.kind === 'dock' ? (settings.dockFolderId || rootFolder?.id || '') : target.kind === 'workspace' ? (workspaces.find(w => w.id === target.workspaceId)?.rootFolderId ?? '') : target.parentId;
      setSelection({ ids: new Set(dragIds), scopeFolderId: moveTargetScope });

      // Skip the toast for no-op drops where every item already lives in the
      // target scope (target scope == source scope) — nothing was relocated.
      const relocated = snapshots.filter(s => s.parentId !== moveTargetScope);
      if (relocated.length > 0) {
        const count = relocated.length;
        pushToast({
          kind: 'info',
          message: `Moved ${count} ${count === 1 ? 'item' : 'items'}`,
          action: {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                try {
                  await restoreMoveSnapshots(relocated, moveBookmark);
                  await refreshTree();
                } catch {
                  pushToast({ kind: 'error', message: 'Couldn’t undo the move.' });
                }
              })();
            },
          },
        });
      }
    } finally {
      await refreshTree();
    }
  }, [tree, refreshTree, rootFolder, settings.dockFolderId, workspaces, setSelection, pushToast]);

  // Drag itself is always live so relocation (into a folder, the dock, or another
  // workspace) works in every sort mode. Only reordering — positioning between
  // siblings — is gated to manual sort, since auto-sort recomputes position.
  const reorderEnabled = bookmarkSortMode === 'manual';

  const canvasDragPreview = useDrag({
    surface: canvasEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: true,
    reorderEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
    onReorderBlocked,
    dragEngagedRef,
    onSpringOpenWorkspace: handleSpringOpenWorkspace,
  });
  const overlayDragPreview = useDrag({
    surface: overlayBodyEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: true,
    reorderEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
    onReorderBlocked,
    dragEngagedRef,
    onSpringOpenWorkspace: handleSpringOpenWorkspace,
  });
  const dockDragPreview = useDrag({
    surface: dockEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: true,
    reorderEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
    onReorderBlocked,
    dragEngagedRef,
    onSpringOpenWorkspace: handleSpringOpenWorkspace,
  });
  const dragPreview = canvasDragPreview ?? overlayDragPreview ?? dockDragPreview;

  // `dragEnabled` drives the section-header drag handle affordance, which is a
  // reorder-only interaction — so it tracks reorderEnabled (manual sort).
  return { dragPreview, dragEnabled: reorderEnabled };
}
