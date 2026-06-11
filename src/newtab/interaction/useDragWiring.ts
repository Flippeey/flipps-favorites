import { useCallback } from 'react';
import type { AppSettings, BookmarkNode, WorkspaceRecord } from '@/shared/messages';
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
  onSwitchWorkspace: (id: string) => void;
  // Surfaced once per drag when a reorder is attempted under a non-manual sort.
  onReorderBlocked: () => void;
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
    onSwitchWorkspace, onReorderBlocked,
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

  // Drag itself is always live so relocation (into a folder, the dock, or another
  // workspace) works in every sort mode. Only reordering — positioning between
  // siblings — is gated to manual sort, since auto-sort recomputes position.
  const reorderEnabled = settings.bookmarkSortMode === 'manual';

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
