import { useCallback, type MouseEvent } from 'react';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/messages';
import type { ContextMenuItem } from '../components/ContextMenu';
import type { MarqueeSelection } from '../interaction/useMarquee';
import type { WorkspaceSectionId, AppSectionId } from '../components/settings';
import { extensionApi } from '@/shared/browser';
import { findFolder, findNode, isFolder } from '../lib/tree';
import { IS_MAC } from '../lib/platform';
import { MAX_WORKSPACES } from '@/shared/constants';
import { normalizeBookmarkUrl } from '../lib/url';

interface UseContextMenuBuilderArgs {
  tree: BookmarkNode[];
  rootFolder: BookmarkNode | null;
  workspaces: WorkspaceRecord[];
  selection: MarqueeSelection;
  setContextMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void;
  defaultParentId: () => string;
  handleNewBookmark: (parentId?: string, parentTitle?: string) => void;
  handleNewFolder: (parentId?: string, parentTitle?: string) => void;
  handleAddWorkspace: () => void;
  handleCreateWorkspaceFromFolder: (folderId: string, folderTitle: string) => Promise<'created' | 'at_max' | 'already_exists'>;
  handlePickFolder: (folder: BookmarkNode) => void;
  handlePickBookmark: (item: BookmarkNode) => void;
  handleEditBookmark: (item: BookmarkNode) => void;
  handleRenameFolder: (folder: BookmarkNode) => void;
  handleDuplicateWorkspace: (id: string) => Promise<void>;
  openWorkspaceSettings: (section?: WorkspaceSectionId) => void;
  openAppSettings: (section?: AppSectionId) => void;
  setConfirmDeleteFolder: (folder: BookmarkNode | null) => void;
  setConfirmDeleteBatch: (ids: string[] | null) => void;
  onMoveSelectionToNewFolder: (ids: string[]) => void;
  setRenameWorkspaceTarget: (ws: WorkspaceRecord | null) => void;
  setConfirmDeleteWorkspace: (ws: WorkspaceRecord | null) => void;
  onDeleteBookmark: (item: BookmarkNode) => void | Promise<void>;
  onCreateFromFolderResult: (result: 'created' | 'at_max' | 'already_exists', folderTitle: string) => void;
}

interface UseContextMenuBuilderResult {
  buildContextMenuItems: (target: BookmarkNode | null, sectionFolder?: BookmarkNode | null) => ContextMenuItem[];
  handleOpenAddMenu: (x: number, y: number) => void;
  handleWorkspaceContextMenu: (id: string, x: number, y: number) => void;
  handleCanvasContextMenu: (event: MouseEvent) => void;
}

export function useContextMenuBuilder(args: UseContextMenuBuilderArgs): UseContextMenuBuilderResult {
  const {
    tree,
    rootFolder,
    workspaces,
    selection,
    setContextMenu,
    defaultParentId,
    handleNewBookmark,
    handleNewFolder,
    handleAddWorkspace,
    handleCreateWorkspaceFromFolder,
    handlePickFolder,
    handlePickBookmark,
    handleEditBookmark,
    handleRenameFolder,
    handleDuplicateWorkspace,
    openWorkspaceSettings,
    openAppSettings,
    setConfirmDeleteFolder,
    setConfirmDeleteBatch,
    onMoveSelectionToNewFolder,
    setRenameWorkspaceTarget,
    setConfirmDeleteWorkspace,
    onDeleteBookmark,
    onCreateFromFolderResult,
  } = args;

  const buildContextMenuItems = useCallback((target: BookmarkNode | null, sectionFolder: BookmarkNode | null = null): ContextMenuItem[] => {
    if (target == null) {
      const parentId = sectionFolder?.id ?? defaultParentId();
      const labelSuffix = sectionFolder ? ` in ${sectionFolder.title}` : '';
      const atMax = workspaces.length >= MAX_WORKSPACES;
      return [
        { kind: 'item', icon: 'bookmark',       label: `Add bookmark${labelSuffix}`, onClick: () => handleNewBookmark(parentId, sectionFolder?.title) },
        { kind: 'item', icon: 'folderPlus', label: `Add folder${labelSuffix}`,
          onClick: () => handleNewFolder(parentId, sectionFolder?.title) },
        { kind: 'item', icon: 'folderTree', label: 'Add workspace', disabled: atMax, title: atMax ? `Workspace limit reached (${MAX_WORKSPACES})` : undefined, onClick: () => handleAddWorkspace() },
        { kind: 'separator' },
        { kind: 'item', icon: 'settings',   label: 'Settings', onClick: () => openAppSettings() },
      ];
    }
    if (isFolder(target)) {
      const folderAlreadyWorkspace = workspaces.some(w => w.rootFolderId === target.id);
      const atMax = workspaces.length >= MAX_WORKSPACES;
      const createWsDisabled = atMax || folderAlreadyWorkspace;
      const createWsTitle = atMax
        ? `Workspace limit reached (${MAX_WORKSPACES})`
        : folderAlreadyWorkspace
          ? 'This folder is already a workspace root'
          : undefined;
      return [
        { kind: 'item', icon: 'folder',     label: 'Open folder', kbd: '↵', onClick: () => handlePickFolder(target) },
        { kind: 'item', icon: 'pencil',     label: 'Rename',
          onClick: () => handleRenameFolder(target) },
        { kind: 'separator' },
        { kind: 'item', icon: 'bookmark',       label: 'New bookmark inside',
          onClick: () => handleNewBookmark(target.id, target.title) },
        { kind: 'item', icon: 'folderPlus', label: 'New folder inside',
          onClick: () => handleNewFolder(target.id, target.title) },
        { kind: 'separator' },
        { kind: 'item', icon: 'folderTree', label: 'Create workspace', disabled: createWsDisabled, title: createWsTitle,
          onClick: () => { void handleCreateWorkspaceFromFolder(target.id, target.title).then(result => onCreateFromFolderResult(result, target.title)); } },
        { kind: 'separator' },
        { kind: 'item', icon: 'trash', label: 'Delete folder', kbd: IS_MAC ? '⌫' : 'Del', destructive: true,
          onClick: () => setConfirmDeleteFolder(target) },
      ];
    }
    const isInSelection = selection.ids.has(target.id) && selection.ids.size > 1;
    const deleteLabel = isInSelection ? `Delete ${selection.ids.size} items` : 'Delete';
    const deleteAction = isInSelection
      ? () => setConfirmDeleteBatch(Array.from(selection.ids))
      : () => { void onDeleteBookmark(target); };
    const targetIds = isInSelection ? Array.from(selection.ids) : [target.id];
    const bookmarkUrls = targetIds
      .map(id => findNode(tree, id))
      .filter((n): n is BookmarkNode => !!n?.url)
      .map(n => normalizeBookmarkUrl(n.url!));
    const multi = bookmarkUrls.length > 1;
    const newTabLabel = multi ? `Open ${bookmarkUrls.length} in new tabs` : 'Open in new tab';
    const newWindowLabel = multi ? `Open ${bookmarkUrls.length} in new window` : 'Open in new window';
    const openInNewTabs = () => {
      for (const url of bookmarkUrls) window.open(url, '_blank', 'noopener');
    };
    const openInNewWindow = () => {
      if (bookmarkUrls.length === 0) return;
      extensionApi.windows?.create?.({ url: bookmarkUrls.length === 1 ? bookmarkUrls[0] : bookmarkUrls });
    };
    return [
      { kind: 'item', icon: 'link',         label: 'Open',            kbd: '↵',  onClick: () => handlePickBookmark(target) },
      { kind: 'item', icon: 'arrowRight',   label: newTabLabel,       kbd: multi ? undefined : (IS_MAC ? '⌘↵' : 'Ctrl+↵'), onClick: openInNewTabs },
      { kind: 'item', icon: 'externalLink', label: newWindowLabel,    onClick: openInNewWindow },
      { kind: 'item', icon: 'copy',         label: 'Copy URL',        onClick: () => target.url && navigator.clipboard?.writeText(normalizeBookmarkUrl(target.url)) },
      { kind: 'separator' },
      { kind: 'item', icon: 'pencil',       label: 'Edit…',           onClick: () => handleEditBookmark(target) },
      ...(isInSelection
        ? [{ kind: 'item' as const, icon: 'folderPlus' as const, label: `Move ${selection.ids.size} to new folder…`,
            onClick: () => onMoveSelectionToNewFolder(targetIds) }]
        : []),
      { kind: 'separator' },
      { kind: 'item', icon: 'trash',        label: deleteLabel,       kbd: IS_MAC ? '⌫' : 'Del', destructive: true,
        onClick: deleteAction },
    ];
  }, [defaultParentId, handleEditBookmark, handleNewBookmark, handleNewFolder, handlePickBookmark, handlePickFolder, handleRenameFolder, handleAddWorkspace, handleCreateWorkspaceFromFolder, onCreateFromFolderResult, workspaces, selection, onDeleteBookmark, onMoveSelectionToNewFolder]);

  const handleOpenAddMenu = useCallback((x: number, y: number) => {
    const atMax = workspaces.length >= MAX_WORKSPACES;
    setContextMenu({
      x, y,
      items: [
        { kind: 'item', icon: 'bookmark',    label: 'Add bookmark',  kbd: 'A', onClick: () => handleNewBookmark() },
        { kind: 'item', icon: 'folderPlus', label: 'Add folder',    kbd: 'F', onClick: () => handleNewFolder() },
        { kind: 'item', icon: 'folderTree', label: 'Add workspace', kbd: 'W', disabled: atMax, title: atMax ? `Workspace limit reached (${MAX_WORKSPACES})` : undefined, onClick: () => handleAddWorkspace() },
      ],
    });
  }, [workspaces.length, handleNewBookmark, handleNewFolder, handleAddWorkspace, setContextMenu]);

  const handleWorkspaceContextMenu = useCallback((id: string, x: number, y: number) => {
    const ws = workspaces.find(w => w.id === id);
    if (!ws) return;
    const atMax = workspaces.length >= MAX_WORKSPACES;
    const canDelete = workspaces.length > 1;
    setContextMenu({
      x, y,
      items: [
        { kind: 'item', icon: 'palette', label: 'Appearance', onClick: () => openWorkspaceSettings('appearance') },
        { kind: 'item', icon: 'rows',    label: 'Layout',     onClick: () => openWorkspaceSettings('layout') },
        { kind: 'separator' },
        { kind: 'item', icon: 'pencil',  label: 'Rename…',    onClick: () => setRenameWorkspaceTarget(ws) },
        { kind: 'item', icon: 'copy',    label: 'Duplicate',  disabled: atMax, title: atMax ? `Workspace limit reached (${MAX_WORKSPACES})` : undefined, onClick: () => { void handleDuplicateWorkspace(id); } },
        { kind: 'separator' },
        { kind: 'item', icon: 'trash',   label: 'Delete…',    destructive: true, disabled: !canDelete, title: !canDelete ? 'Create another workspace first' : undefined, onClick: () => setConfirmDeleteWorkspace(ws) },
      ],
    });
  }, [workspaces, handleDuplicateWorkspace, openWorkspaceSettings, setContextMenu, setRenameWorkspaceTarget, setConfirmDeleteWorkspace]);

  const handleCanvasContextMenu = useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"], .ff-modal-scrim, .ff-drawer, .ff-ctx, .ff-nav, .ff-results')) return;
    event.preventDefault();
    const tileEl = target.closest('[data-item-id]') as HTMLElement | null;
    let menuTarget: BookmarkNode | null = null;
    let sectionFolder: BookmarkNode | null = null;
    if (tileEl?.dataset.itemId) {
      menuTarget = findNode(tree, tileEl.dataset.itemId);
    } else {
      const scopeEl = target.closest('[data-scope-folder-id]') as HTMLElement | null;
      const scopeId = scopeEl?.dataset.scopeFolderId;
      if (scopeId && scopeId !== rootFolder?.id) sectionFolder = findFolder(tree, scopeId);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, items: buildContextMenuItems(menuTarget, sectionFolder) });
  }, [tree, buildContextMenuItems, rootFolder?.id, setContextMenu]);

  return { buildContextMenuItems, handleOpenAddMenu, handleWorkspaceContextMenu, handleCanvasContextMenu };
}
