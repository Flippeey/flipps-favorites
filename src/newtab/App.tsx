import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AppSettings, BookmarkNode, BookmarkSortMode, SortDirection, WorkspaceRecord } from '../shared/messages';
import { ConfirmBatchDeleteDialog, ConfirmDeleteDialog } from './components/ConfirmDeleteDialog';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { Dock } from './components/Dock';
import { EditDialog, type EditTarget } from './components/EditDialog';
import { FolderNameDialog, type FolderNameDialogTarget } from './components/FolderNameDialog';
import { FolderOverlay } from './components/FolderOverlay';
import { NewWorkspaceDialog } from './components/NewWorkspaceDialog';
import { QuickAddDialog } from './components/QuickAddDialog';
import { buildSearchIndex, ClockGreeting, HeroSearch, type FlatSearchResult } from './components/HeroSearch';
import { Ico } from './components/Ico';
import { Onboarding } from './components/Onboarding';
import { SettingsDrawer } from './components/settings';
import { TopNav, type SortChoice } from './components/TopNav';
import { SectionsView, TilesView, FolderPageView } from './components/views';
import { useMarquee, type MarqueeSelection } from './interaction/useMarquee';
import { useDrag } from './interaction/useDrag';
import { applyAccent, applyDensity, resolveThemeAttr } from './lib/accent';
import { IS_MAC } from './lib/platform';
import { getBookmarkTree, getBookmarkUsage, getSettings, moveBookmark, patchSettings, recordBookmarkUse, removeBookmark, createWorkspace, patchWorkspace, deleteWorkspace } from './lib/messaging';
import { useBlobUrl } from './lib/useBlobUrl';
import { findFolder, findNode, isFolder, resolveRootFolder, sortChildren } from './lib/tree';
import { markOnboardingCompleted, defaultWorkspaceSettings, readWorkspaceWallpaper, writeWorkspaceWallpaper } from '../shared/storage';
import { MAX_WORKSPACES } from '../shared/constants';

interface AppProps {
  initialSettings: AppSettings;
  initialTree: BookmarkNode[];
  initialWorkspaces: WorkspaceRecord[];
  initialOnboardOpen?: boolean;
}

function settingsToSortValue(mode: BookmarkSortMode, direction: SortDirection): string {
  if (mode === 'manual') return 'manual';
  return `${mode}:${direction}`;
}

export function App({ initialSettings, initialTree, initialWorkspaces, initialOnboardOpen }: AppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [tree, setTree] = useState(initialTree);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);

  const activeWorkspace = useMemo(
    () => workspaces.find(w => w.id === settings.activeWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, settings.activeWorkspaceId],
  );

  const [workspaceWallpaper, setWorkspaceWallpaper] = useState('');

  useEffect(() => {
    if (!activeWorkspace) { setWorkspaceWallpaper(''); return; }
    let cancelled = false;
    readWorkspaceWallpaper(activeWorkspace.id).then(url => {
      if (!cancelled) setWorkspaceWallpaper(url);
    }).catch(() => { if (!cancelled) setWorkspaceWallpaper(''); });
    return () => { cancelled = true; };
  }, [activeWorkspace?.id]);

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const openFolder = useMemo(
    () => (openFolderId ? findFolder(tree, openFolderId) ?? null : null),
    [tree, openFolderId],
  );
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [quickAddTarget, setQuickAddTarget] = useState<{ parentId: string; parentTitle?: string } | null>(null);
  const [folderNameTarget, setFolderNameTarget] = useState<FolderNameDialogTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<'appearance' | 'workspace-manage'>('appearance');
  const [onboardOpen, setOnboardOpen] = useState(initialOnboardOpen ?? false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<BookmarkNode[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<BookmarkNode | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string[] | null>(null);

  const [selection, setSelection] = useState<MarqueeSelection>({ ids: new Set(), scopeFolderId: '' });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  // Keyboard navigation: tracks which tile is currently focused via arrow keys.
  // Null = no keyboard focus (focus model resumes from real :focus or :focus-visible).
  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLElement | null>(null);
  const dragEngagedRef = useRef(false);
  const lastClickedRef = useRef<string | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const [appEl, setAppEl] = useState<HTMLElement | null>(null);
  const [overlayBodyEl, setOverlayBodyEl] = useState<HTMLElement | null>(null);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);

  const rootFolder = useMemo(
    () => resolveRootFolder(tree, activeWorkspace?.rootFolderId ?? ''),
    [tree, activeWorkspace?.rootFolderId],
  );

  // Apply tweaks → CSS variables
  useEffect(() => {
    if (activeWorkspace) applyAccent(activeWorkspace.accentColor);
  }, [activeWorkspace?.accentColor]);

  useEffect(() => {
    if (!activeWorkspace) return;
    applyDensity(activeWorkspace.layoutPreset, {
      tileSize: activeWorkspace.bookmarkIconSize,
      tileWidth: activeWorkspace.bookmarkTileWidth,
      gapX: activeWorkspace.favoritesColumnGap,
      gapY: activeWorkspace.favoritesRowGap,
    });
  }, [
    activeWorkspace?.layoutPreset,
    activeWorkspace?.bookmarkIconSize,
    activeWorkspace?.bookmarkTileWidth,
    activeWorkspace?.favoritesColumnGap,
    activeWorkspace?.favoritesRowGap,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveThemeAttr(settings.themeMode);
  }, [settings.themeMode]);

  useEffect(() => {
    let cancelled = false;
    getBookmarkUsage().then(u => { if (!cancelled) setUsage(u); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  const handlePatch = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
    try {
      const next = await patchSettings(patch);
      setSettings(next);
    } catch {
      // keep optimistic value
    }
  }, []);

  const handleSwitchWorkspace = useCallback(async (id: string) => {
    setFolderPath([]);
    setSelection({ ids: new Set(), scopeFolderId: '' });
    await handlePatch({ activeWorkspaceId: id });
  }, [handlePatch]);

  const handlePatchWorkspace = useCallback(async (patch: Partial<WorkspaceRecord>) => {
    if (!activeWorkspace) return;
    const optimistic = { ...activeWorkspace, ...patch };
    setWorkspaces(prev => prev.map(w => w.id === optimistic.id ? optimistic : w));
    try {
      const next = await patchWorkspace(activeWorkspace.id, patch);
      setWorkspaces(prev => prev.map(w => w.id === next.id ? next : w));
    } catch {
      // keep optimistic value
    }
  }, [activeWorkspace]);

  const handleSetWorkspaceWallpaper = useCallback(async (dataUrl: string) => {
    if (!activeWorkspace) return;
    setWorkspaceWallpaper(dataUrl);
    try {
      await writeWorkspaceWallpaper(activeWorkspace.id, dataUrl);
    } catch {
      // keep optimistic value
    }
  }, [activeWorkspace]);

  const handleCreateWorkspace = useCallback(async (rootFolderId: string, name: string) => {
    if (workspaces.length >= MAX_WORKSPACES) return;
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      rootFolderId,
      ...defaultWorkspaceSettings,
    };
    try {
      const created = await createWorkspace(workspace);
      setWorkspaces(prev => [...prev, created]);
      await handlePatch({ activeWorkspaceId: created.id });
    } catch {
      // creation failed — leave UI unchanged
    }
  }, [handlePatch]);

  const handleDeleteWorkspace = useCallback(async (id: string) => {
    if (workspaces.length <= 1) return;
    try {
      await deleteWorkspace(id);
    } catch {
      return;
    }
    const remaining = workspaces.filter(w => w.id !== id);
    const nextActiveId = settings.activeWorkspaceId === id ? remaining[0]?.id : undefined;
    setWorkspaces(remaining);
    if (nextActiveId) await handlePatch({ activeWorkspaceId: nextActiveId });
  }, [workspaces, settings.activeWorkspaceId, handlePatch]);

  const handleDuplicateWorkspace = useCallback(async (id: string) => {
    if (workspaces.length >= MAX_WORKSPACES) return;
    const source = workspaces.find(w => w.id === id);
    if (!source) return;
    const duplicate: WorkspaceRecord = {
      ...source,
      id: crypto.randomUUID(),
      name: `Copy of ${source.name}`,
    };
    try {
      const created = await createWorkspace(duplicate);
      if (source.backgroundMode === 'wallpaper') {
        const wallpaper = await readWorkspaceWallpaper(source.id);
        if (wallpaper) await writeWorkspaceWallpaper(created.id, wallpaper);
      }
      setWorkspaces(prev => [...prev, created]);
      await handlePatch({ activeWorkspaceId: created.id });
    } catch {
      // creation failed — leave UI unchanged
    }
  }, [workspaces, handlePatch]);

  const handleAddWorkspace = useCallback(() => {
    setNewWorkspaceOpen(true);
  }, []);

  const handleWorkspaceContextMenu = useCallback((id: string, x: number, y: number) => {
    const atMax = workspaces.length >= MAX_WORKSPACES;
    setContextMenu({
      x, y,
      items: [
        { kind: 'item', icon: 'palette', label: 'Appearance', onClick: () => {
          setSettingsInitialSection('appearance');
          setSettingsOpen(true);
        }},
        { kind: 'item', icon: 'copy', label: 'Duplicate', disabled: atMax, title: atMax ? `Workspace limit reached (${MAX_WORKSPACES})` : undefined, onClick: () => {
          void handleDuplicateWorkspace(id);
        }},
        { kind: 'item', icon: 'settings', label: 'Manage', onClick: () => {
          setSettingsInitialSection('workspace-manage');
          setSettingsOpen(true);
        }},
      ],
    });
  }, [workspaces.length, handleDuplicateWorkspace]);

  const refreshTree = useCallback(async () => {
    try {
      const t = await getBookmarkTree();
      setTree(t);
    } catch {
      // ignore
    }
  }, []);

  const sortedChildren = useCallback((children?: BookmarkNode[]) => {
    if (!children) return [];
    return sortChildren(children, settings.bookmarkSortMode, settings.bookmarkSortDirection, usage);
  }, [settings.bookmarkSortMode, settings.bookmarkSortDirection, usage]);

  const sortedRootChildren = useMemo(() => sortedChildren(rootFolder?.children), [rootFolder, sortedChildren]);
  const sortedCurrentFolder: BookmarkNode | null = folderPath.length > 0
    ? { ...folderPath[folderPath.length - 1], children: sortedChildren(folderPath[folderPath.length - 1].children) }
    : null;
  const isAtRoot = folderPath.length === 0;

  // Flat list of currently navigable tiles in render order — drives arrow key navigation.
  // Sections view flattens across all section grids; folder-page view uses current folder.
  const navItems = useMemo<BookmarkNode[]>(() => {
    if (!isAtRoot && sortedCurrentFolder) return sortedCurrentFolder.children ?? [];
    if (settings.folderMode === 'sections') {
      const out: BookmarkNode[] = [];
      for (const folder of sortedRootChildren.filter(isFolder)) {
        for (const child of folder.children ?? []) out.push(child);
      }
      return out;
    }
    const folders = sortedRootChildren.filter(isFolder);
    const bookmarks = sortedRootChildren.filter(c => !isFolder(c));
    return [...folders, ...bookmarks];
  }, [isAtRoot, sortedCurrentFolder, sortedRootChildren, settings.folderMode]);

  const dockItems = useMemo<BookmarkNode[]>(() => {
    if (!settings.showDock) return [];
    if (settings.dockFolderId) {
      const folder = findFolder(tree, settings.dockFolderId);
      if (folder) return (folder.children ?? []).slice(0, 8);
    }
    return (rootFolder?.children ?? []).slice(0, 8);
  }, [tree, settings.showDock, settings.dockFolderId, rootFolder]);

  const dockMode: 'always' | 'hover' | 'hidden' =
    !settings.showDock ? 'hidden' : settings.autoHideDock ? 'hover' : 'always';

  const handlePickFolder = useCallback((folder: BookmarkNode) => {
    if (settings.folderOpenMode === 'page') {
      setFolderPath(p => [...p, folder]);
    } else {
      setOpenFolderId(folder.id);
    }
  }, [settings.folderOpenMode]);

  const handlePickBookmark = useCallback((item: BookmarkNode, event?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    if (!item.url) return;
    const usedAt = Date.now();
    setUsage(prev => ({ ...prev, [item.id]: usedAt }));
    recordBookmarkUse(item.id).catch(() => { /* ignore */ });
    const url = item.url.startsWith('http') ? item.url : `https://${item.url}`;
    const newTab = settings.openLinksInNewTab !== Boolean(event?.metaKey || event?.ctrlKey);
    if (newTab) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
  }, [settings.openLinksInNewTab]);

  const handleGoToCrumb = useCallback((idx: number) => setFolderPath(p => p.slice(0, idx)), []);

  const sortChoice = settingsToSortValue(settings.bookmarkSortMode, settings.bookmarkSortDirection);

  const handleSortChange = useCallback((choice: SortChoice) => {
    handlePatch({ bookmarkSortMode: choice.mode, bookmarkSortDirection: choice.direction });
  }, [handlePatch]);

  const defaultParentId = useCallback((): string => {
    if (!isAtRoot && folderPath.length > 0) return folderPath[folderPath.length - 1].id;
    return rootFolder?.id ?? '';
  }, [isAtRoot, folderPath, rootFolder]);

  const handleNewBookmark = useCallback((parentId?: string, parentTitle?: string) => {
    setQuickAddTarget({ parentId: parentId ?? defaultParentId(), parentTitle });
  }, [defaultParentId]);

  const handleNewFolder = useCallback((parentId?: string, parentTitle?: string) => {
    setFolderNameTarget({ mode: 'create', parentId: parentId ?? defaultParentId(), parentTitle });
  }, [defaultParentId]);

  const handleOpenAddMenu = useCallback((x: number, y: number) => {
    const atMax = workspaces.length >= MAX_WORKSPACES;
    setContextMenu({
      x, y,
      items: [
        { kind: 'item', icon: 'link',       label: 'Add bookmark',  onClick: () => handleNewBookmark() },
        { kind: 'item', icon: 'folderPlus', label: 'Add folder',    onClick: () => handleNewFolder() },
        { kind: 'item', icon: 'layers',     label: 'Add workspace', disabled: atMax, title: atMax ? `Workspace limit reached (${MAX_WORKSPACES})` : undefined, onClick: () => handleAddWorkspace() },
      ],
    });
  }, [workspaces.length, handleNewBookmark, handleNewFolder, handleAddWorkspace]);

  const handleRenameFolder = useCallback((folder: BookmarkNode) => {
    setFolderNameTarget({ mode: 'rename', id: folder.id, title: folder.title });
  }, []);

  const handleEditBookmark = useCallback((item: BookmarkNode) => {
    setEditTarget({ id: item.id, parentId: item.parentId, title: item.title, url: item.url ?? '' });
  }, []);

  const buildContextMenuItems = useCallback((target: BookmarkNode | null, sectionFolder: BookmarkNode | null = null): ContextMenuItem[] => {
    if (target == null) {
      const parentId = sectionFolder?.id ?? defaultParentId();
      const labelSuffix = sectionFolder ? ` in ${sectionFolder.title}` : '';
      const atMax = workspaces.length >= MAX_WORKSPACES;
      return [
        { kind: 'item', icon: 'plus',       label: `Add bookmark${labelSuffix}`, onClick: () => handleNewBookmark(parentId, sectionFolder?.title) },
        { kind: 'item', icon: 'folderPlus', label: `Add folder${labelSuffix}`,
          onClick: () => handleNewFolder(parentId, sectionFolder?.title) },
        { kind: 'item', icon: 'layers',     label: 'Add workspace', disabled: atMax, title: atMax ? `Workspace limit reached (${MAX_WORKSPACES})` : undefined, onClick: () => handleAddWorkspace() },
        { kind: 'separator' },
        { kind: 'item', icon: 'settings',   label: 'Settings', onClick: () => setSettingsOpen(true) },
      ];
    }
    if (isFolder(target)) {
      return [
        { kind: 'item', icon: 'folder',     label: 'Open folder', kbd: '↵', onClick: () => handlePickFolder(target) },
        { kind: 'item', icon: 'pencil',     label: 'Rename',
          onClick: () => handleRenameFolder(target) },
        { kind: 'separator' },
        { kind: 'item', icon: 'plus',       label: 'New bookmark inside',
          onClick: () => handleNewBookmark(target.id, target.title) },
        { kind: 'item', icon: 'folderPlus', label: 'New folder inside',
          onClick: () => handleNewFolder(target.id, target.title) },
        { kind: 'separator' },
        { kind: 'item', icon: 'trash', label: 'Delete folder', kbd: IS_MAC ? '⌫' : 'Del', destructive: true,
          onClick: () => setConfirmDeleteFolder(target) },
      ];
    }
    const isInSelection = selection.ids.has(target.id) && selection.ids.size > 1;
    const deleteLabel = isInSelection ? `Delete ${selection.ids.size} items` : 'Delete';
    const deleteAction = isInSelection
      ? () => setConfirmDeleteBatch(Array.from(selection.ids))
      : async () => { await removeBookmark(target.id); refreshTree(); };
    return [
      { kind: 'item', icon: 'link',       label: 'Open',            kbd: '↵',  onClick: () => handlePickBookmark(target) },
      { kind: 'item', icon: 'arrowRight', label: 'Open in new tab', kbd: IS_MAC ? '⌘↵' : 'Ctrl+↵', onClick: () => target.url && window.open(target.url.startsWith('http') ? target.url : `https://${target.url}`, '_blank', 'noopener') },
      { kind: 'item', icon: 'copy',       label: 'Copy URL',                   onClick: () => target.url && navigator.clipboard?.writeText(target.url.startsWith('http') ? target.url : `https://${target.url}`) },
      { kind: 'separator' },
      { kind: 'item', icon: 'pencil',     label: 'Edit…',           onClick: () => handleEditBookmark(target) },
      { kind: 'separator' },
      { kind: 'item', icon: 'trash',      label: deleteLabel,       kbd: IS_MAC ? '⌫' : 'Del', destructive: true,
        onClick: deleteAction },
    ];
  }, [defaultParentId, handleEditBookmark, handleNewBookmark, handleNewFolder, handlePickBookmark, handlePickFolder, handleRenameFolder, handleAddWorkspace, workspaces.length, selection, refreshTree]);

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent) => {
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
  }, [tree, buildContextMenuItems]);

  const searchIndex = useMemo(() => buildSearchIndex(tree), [tree]);

  const onPickSearchBookmark = useCallback((r: FlatSearchResult) => {
    if (!r.url) return;
    handlePickBookmark({ id: r.id, title: r.title, url: r.url });
  }, [handlePickBookmark]);

  const onPickSearchFolder = useCallback((r: FlatSearchResult) => {
    const folder = findFolder(tree, r.id);
    if (folder) handlePickFolder(folder);
  }, [tree, handlePickFolder]);

  // ESC clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectionRef.current.ids.size > 0) {
        setSelection({ ids: new Set(), scopeFolderId: '' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Alt+1-9 switches workspace (only when no modifier conflicts and no input is focused)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      const digit = parseInt(e.key, 10);
      if (Number.isNaN(digit)) return;
      if (digit >= 1 && digit <= 9 && digit <= workspaces.length) {
        e.preventDefault();
        handleSwitchWorkspace(workspaces[digit - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [workspaces, handleSwitchWorkspace]);

  // Reset keyboard focus when navigation context changes (workspace switch, folder open/close).
  useEffect(() => {
    setFocusedTileId(null);
  }, [activeWorkspace?.id, folderPath.length, openFolderId]);

  // Scroll focused tile into view smoothly. Manual calculation avoids scrollIntoView
  // scrolling the nav bar out of view on some browsers when block:'nearest' overshoots.
  useEffect(() => {
    if (!focusedTileId || !canvasEl) return;
    const el = canvasEl.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(focusedTileId)}"]`);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vPad = 16;
    if (rect.top < vPad) {
      window.scrollBy({ top: rect.top - vPad, behavior: 'smooth' });
    } else if (rect.bottom > window.innerHeight - vPad) {
      window.scrollBy({ top: rect.bottom - window.innerHeight + vPad, behavior: 'smooth' });
    }
  }, [focusedTileId, canvasEl]);

  const getOrderedChildren = useCallback((folderId: string): Array<{ id: string }> => {
    const folder = findFolder(tree, folderId);
    return sortedChildren(folder?.children).map(c => ({ id: c.id }));
  }, [tree, sortedChildren]);

  const handleDragCommit = useCallback(async (dragIds: string[], target: import('./interaction/useDrag').DropTarget) => {
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
  }, [refreshTree, rootFolder, settings.dockFolderId, workspaces]);

  const dragEnabled = settings.bookmarkSortMode === 'manual';

  const marqueeRect = useMarquee({
    surface: canvasEl,
    container: appEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: true,
    selectionRef,
    onSelect: setSelection,
  });
  const overlayMarqueeRect = useMarquee({
    surface: overlayBodyEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: true,
    selectionRef,
    onSelect: setSelection,
  });

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

  const handleTileClick = useCallback((item: BookmarkNode, event: React.MouseEvent) => {
    if (dragEngagedRef.current) {
      dragEngagedRef.current = false;
      return;
    }
    const scope = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[data-scope-folder-id]')?.dataset.scopeFolderId ?? rootFolder?.id ?? '';

    if (event.metaKey || event.ctrlKey) {
      setSelection(prev => {
        const sameScope = prev.scopeFolderId === scope;
        const ids = sameScope ? new Set(prev.ids) : new Set<string>();
        if (ids.has(item.id)) ids.delete(item.id);
        else ids.add(item.id);
        return { ids, scopeFolderId: scope };
      });
      lastClickedRef.current = item.id;
      return;
    }

    if (event.shiftKey) {
      const anchor = lastClickedRef.current;
      if (anchor && navItems.length > 0) {
        const anchorIdx = navItems.findIndex(n => n.id === anchor);
        const clickIdx = navItems.findIndex(n => n.id === item.id);
        if (anchorIdx >= 0 && clickIdx >= 0) {
          const from = Math.min(anchorIdx, clickIdx);
          const to = Math.max(anchorIdx, clickIdx);
          setSelection(prev => {
            const ids = prev.scopeFolderId === scope ? new Set(prev.ids) : new Set<string>();
            for (let i = from; i <= to; i++) ids.add(navItems[i].id);
            return { ids, scopeFolderId: scope };
          });
          return;
        }
      }
      // Fallback: no anchor — treat like Ctrl+Click
      setSelection(prev => {
        const ids = prev.scopeFolderId === scope ? new Set(prev.ids) : new Set<string>();
        ids.add(item.id);
        return { ids, scopeFolderId: scope };
      });
      lastClickedRef.current = item.id;
      return;
    }

    // Plain click — clear selection. Folder/bookmark open behavior handled by caller.
    if (selectionRef.current.ids.size > 0) {
      setSelection({ ids: new Set(), scopeFolderId: '' });
    }
    lastClickedRef.current = item.id;
    if (isFolder(item)) handlePickFolder(item);
    else handlePickBookmark(item, event);
  }, [handlePickBookmark, handlePickFolder, rootFolder, navItems]);

  const handleDeleteFocused = useCallback(async (item: BookmarkNode) => {
    if (isFolder(item)) {
      setConfirmDeleteFolder(item);
      return;
    }
    try {
      await removeBookmark(item.id);
      refreshTree();
    } catch {
      // ignore
    }
  }, [refreshTree]);

  // Arrow-key grid navigation. Active only when no dialog/overlay/input has focus —
  // otherwise we'd hijack typing or contend with active surfaces.
  const anyOverlayOpen = Boolean(
    settingsOpen || editTarget || quickAddTarget || folderNameTarget || onboardOpen
    || newWorkspaceOpen || confirmDeleteFolder || confirmDeleteBatch || openFolderId || contextMenu,
  );

  useEffect(() => {
    if (anyOverlayOpen) return;
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
        if (isFolder(item)) handlePickFolder(item);
        else handlePickBookmark(item, { metaKey: false, ctrlKey: false });
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
  }, [
    navItems, focusedTileId, canvasEl, anyOverlayOpen,
    handlePickBookmark, handlePickFolder, handleDeleteFocused, buildContextMenuItems,
  ]);

  useEffect(() => {
    if (anyOverlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
      e.preventDefault();
      if (selection.ids.size > 1) {
        setConfirmDeleteBatch(Array.from(selection.ids));
      } else if (selection.ids.size === 1) {
        const id = Array.from(selection.ids)[0];
        const item = navItems.find(n => n.id === id);
        if (item) void handleDeleteFocused(item);
      } else if (focusedTileId) {
        const item = navItems.find(n => n.id === focusedTileId);
        if (item) void handleDeleteFocused(item);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyOverlayOpen, selection, focusedTileId, navItems, handleDeleteFocused]);

  const wallpaperBlobUrl = useBlobUrl(workspaceWallpaper);

  const appStyle = useMemo(() => {
    const ws = activeWorkspace ?? (defaultWorkspaceSettings as WorkspaceRecord);
    const style: Record<string, string> = {};
    if (wallpaperBlobUrl) style['--wallpaper-url'] = `url(${wallpaperBlobUrl})`;
    if (ws.solidBackgroundColor) style['--solid-bg'] = ws.solidBackgroundColor;
    style['--gradient-color'] = ws.gradientColorSource === 'custom'
      ? ws.gradientCustomColor
      : ws.accentColor;
    style['--gradient-intensity'] = String(ws.gradientIntensity / 100);
    style['--wallpaper-alpha'] = `${String(ws.backgroundOpacity)}%`;
    style['--wallpaper-size'] = ws.backgroundFitMode === 'fill'
      ? '100% 100%'
      : ws.backgroundFitMode;
    style['--wallpaper-position'] = ws.backgroundPositionMode;
    return style;
  }, [
    activeWorkspace,
    wallpaperBlobUrl,
  ]);

  return (
    <div
      className="ff-app"
      ref={setAppEl}
      data-bg={activeWorkspace?.backgroundMode ?? 'gradient'}
      data-bg-style={activeWorkspace?.gradientStyle ?? 'top'}
      data-tile-shape={activeWorkspace?.tileShape ?? 'squircle'}
      data-labels={String(activeWorkspace?.showTileLabels ?? true)}
      data-dock={dockMode}
      style={appStyle as CSSProperties}
      onContextMenu={handleCanvasContextMenu}
    >
      {wallpaperBlobUrl && (
        <div
          className="ff-bg-wallpaper"
          aria-hidden="true"
          data-active={activeWorkspace?.backgroundMode === 'wallpaper'}
        />
      )}
      <header>
        <TopNav
          workspaces={workspaces}
          activeWorkspaceId={settings.activeWorkspaceId}
          onSwitchWorkspace={handleSwitchWorkspace}
          onWorkspaceContextMenu={handleWorkspaceContextMenu}
          onOpenAddMenu={handleOpenAddMenu}
          path={folderPath}
          onCrumb={handleGoToCrumb}
          sortValue={sortChoice}
          onSort={handleSortChange}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </header>

      <section className="ff-hero">
        {settings.showClock && <ClockGreeting hourFormat={settings.clockHourFormat} />}
        {settings.showSearchBar && (
          <HeroSearch
            shape={activeWorkspace?.tileShape ?? 'squircle'}
            index={searchIndex}
            usage={usage}
            onPickBookmark={onPickSearchBookmark}
            onPickFolder={onPickSearchFolder}
          />
        )}
      </section>

      <main className="ff-canvas" ref={(el) => { canvasRef.current = el; setCanvasEl(el); }}>
        {!isAtRoot && sortedCurrentFolder ? (
          <FolderPageView
            folder={sortedCurrentFolder}
            shape={activeWorkspace?.tileShape ?? 'squircle'}
            onPickFolder={handleTileClick}
            onPickItem={handleTileClick}
            selectedIds={selection.ids}
            selectionScopeFolderId={selection.scopeFolderId}
            focusedTileId={focusedTileId}
          />
        ) : settings.folderMode === 'sections' ? (
          <SectionsView
            tree={sortedRootChildren.filter(isFolder)}
            scopeFolderId={rootFolder?.id ?? ''}
            shape={activeWorkspace?.tileShape ?? 'squircle'}
            onPickFolder={handleTileClick}
            onPickItem={handleTileClick}
            onSectionMenu={(folder, event) => {
              const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
              setContextMenu({
                x: rect.left,
                y: rect.bottom + 4,
                items: buildContextMenuItems(folder),
              });
            }}
            selectedIds={selection.ids}
            selectionScopeFolderId={selection.scopeFolderId}
            focusedTileId={focusedTileId}
          />
        ) : (
          <TilesView
            tree={sortedRootChildren.filter(isFolder)}
            rootBookmarks={sortedRootChildren.filter(c => !isFolder(c))}
            scopeFolderId={rootFolder?.id ?? ''}
            shape={activeWorkspace?.tileShape ?? 'squircle'}
            onPickFolder={handleTileClick}
            onPickItem={handleTileClick}
            selectedIds={selection.ids}
            selectionScopeFolderId={selection.scopeFolderId}
            focusedTileId={focusedTileId}
          />
        )}
        {marqueeRect && (
          <div
            className="ff-marquee"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />
        )}
      </main>
      {dragPreview && (
        <div className="ff-drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }}>
          <span className="ff-drag-preview__count">{dragPreview.ids.length}</span>
          <span>Move {dragPreview.ids.length === 1 ? 'item' : 'items'}</span>
        </div>
      )}

      <Dock
        items={dockItems}
        mode={dockMode}
        shape={activeWorkspace?.tileShape ?? 'squircle'}
        dockFolderId={settings.dockFolderId || rootFolder?.id || ''}
        onItemClick={handlePickBookmark}
        onFolderClick={handlePickFolder}
        surfaceRef={setDockEl}
      />

      {openFolder && (
        <FolderOverlay
          folder={openFolder}
          rootFolderId={rootFolder?.id ?? ''}
          shape={activeWorkspace?.tileShape ?? 'squircle'}
          onClose={() => setOpenFolderId(null)}
          onPickBookmark={handlePickBookmark}
          onContextMenu={(target, e) => {
            e.preventDefault();
            setContextMenu({ x: e.clientX, y: e.clientY, items: buildContextMenuItems(target) });
          }}
          onNewBookmark={(parentId, parentTitle) => handleNewBookmark(parentId, parentTitle)}
          onNewFolder={(parentId, parentTitle) => handleNewFolder(parentId, parentTitle)}
          bodyRef={setOverlayBodyEl}
          selectedIds={selection.ids}
          selectionScopeFolderId={selection.scopeFolderId}
          onTileSelect={handleTileClick}
          onClearSelection={() => setSelection({ ids: new Set(), scopeFolderId: '' })}
          marqueeRect={overlayMarqueeRect}
        />
      )}

      {editTarget && (
        <EditDialog
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); refreshTree(); }}
        />
      )}

      {quickAddTarget && (
        <QuickAddDialog
          parentId={quickAddTarget.parentId}
          parentTitle={quickAddTarget.parentTitle}
          onClose={() => setQuickAddTarget(null)}
          onSaved={() => { setQuickAddTarget(null); refreshTree(); }}
        />
      )}

      {folderNameTarget && (
        <FolderNameDialog
          target={folderNameTarget}
          onClose={() => setFolderNameTarget(null)}
          onSaved={() => { setFolderNameTarget(null); refreshTree(); }}
        />
      )}

      {newWorkspaceOpen && (
        <NewWorkspaceDialog
          tree={tree}
          onConfirm={handleCreateWorkspace}
          onClose={() => setNewWorkspaceOpen(false)}
        />
      )}

      {confirmDeleteFolder && (
        <ConfirmDeleteDialog
          folder={confirmDeleteFolder}
          onClose={() => setConfirmDeleteFolder(null)}
          onConfirm={async () => {
            await removeBookmark(confirmDeleteFolder.id, true);
            setConfirmDeleteFolder(null);
            await refreshTree();
          }}
        />
      )}

      {confirmDeleteBatch && (
        <ConfirmBatchDeleteDialog
          count={confirmDeleteBatch.length}
          onClose={() => setConfirmDeleteBatch(null)}
          onConfirm={async () => {
            for (const id of confirmDeleteBatch) {
              await removeBookmark(id);
            }
            setConfirmDeleteBatch(null);
            setSelection({ ids: new Set(), scopeFolderId: '' });
            await refreshTree();
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          activeWorkspace={activeWorkspace}
          workspaceWallpaper={workspaceWallpaper}
          onPatchGlobal={handlePatch}
          onPatchWorkspace={handlePatchWorkspace}
          onSetWorkspaceWallpaper={handleSetWorkspaceWallpaper}
          onDeleteWorkspace={handleDeleteWorkspace}
          isOnlyWorkspace={workspaces.length <= 1}
          initialSection={settingsInitialSection}
          tree={tree}
          onClose={() => { setSettingsOpen(false); setSettingsInitialSection('appearance'); }}
          onAfterImport={(next) => { setSettings(next); refreshTree(); }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {onboardOpen && (
        <Onboarding
          settings={settings}
          activeWorkspace={activeWorkspace}
          tree={tree}
          onPatch={handlePatch}
          onPatchWorkspace={handlePatchWorkspace}
          onCreateWorkspace={handleCreateWorkspace}
          onFinish={() => { setOnboardOpen(false); void markOnboardingCompleted(); }}
        />
      )}

      <button
        type="button"
        className="ff-onboarding-replay"
        onClick={() => setOnboardOpen(true)}
        title="Replay onboarding"
        aria-label="Replay onboarding"
      >
        <Ico name="zap" size={16} />
      </button>
    </div>
  );
}
