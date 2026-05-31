import { useCallback } from 'react';
import type { AppSettings, BookmarkNode, WorkspaceRecord } from '../../shared/messages';
import type { MarqueeSelection } from './useMarquee';
import { useDrag, type DropTarget, type DragPreviewState } from './useDrag';
import { moveBookmark } from '../lib/messaging';
import { findFolder } from '../lib/tree';

interface UseDragWiringArgs {
  canvasEl: HTMLElement | null;
  overlayBodyEl: HTMLElement | null;
  dockEl: HTMLElement | null;
  rootFolder: BookmarkNode | null;
  settings: AppSettings;
  workspaces: WorkspaceRecord[];
  tree: BookmarkNode[];
  sortedChildren: (children?: BookmarkNode[]) => BookmarkNode[];
  selectionRef: React.RefObject<MarqueeSelection>;
  setSelection: React.Dispatch<React.SetStateAction<MarqueeSelection>>;
  refreshTree: () => Promise<void>;
  dragEngagedRef: React.RefObject<boolean>;
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
    canvasEl, overlayBodyEl, dockEl, rootFolder, settings, workspaces, tree,
    sortedChildren, selectionRef, setSelection, refreshTree, dragEngagedRef,
  } = args;

  const getOrderedChildren = useCallback((folderId: string): Array<{ id: string }> => {
    const folder = findFolder(tree, folderId);
    return sortedChildren(folder?.children).map(c => ({ id: c.id }));
  }, [tree, sortedChildren]);

  const handleDragCommit = useCallback(async (dragIds: string[], target: DropTarget) => {
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
    } finally {
      await refreshTree();
    }
  }, [refreshTree, rootFolder, settings.dockFolderId, workspaces, setSelection]);

  const dragEnabled = settings.bookmarkSortMode === 'manual';

  const canvasDragPreview = useDrag({
    surface: canvasEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: dragEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
    dragEngagedRef,
  });
  const overlayDragPreview = useDrag({
    surface: overlayBodyEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: dragEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
    dragEngagedRef,
  });
  const dockDragPreview = useDrag({
    surface: dockEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: dragEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
    dragEngagedRef,
  });
  const dragPreview = canvasDragPreview ?? overlayDragPreview ?? dockDragPreview;

  return { dragPreview, dragEnabled };
}
