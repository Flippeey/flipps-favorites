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
import { buildSearchIndex, ClockGreeting, ClockMini, HeroSearch, type FlatSearchResult } from './components/HeroSearch';
import { Ico } from './components/Ico';
import { Onboarding } from './components/Onboarding';
import { AppSettingsDrawer, WorkspaceSettingsDrawer, type AppSectionId, type WorkspaceSectionId } from './components/settings';
import { ConfirmDeleteWorkspaceDialog, WorkspaceRenameDialog } from './components/WorkspaceLifecycleDialogs';
import { TopNav, type SortChoice } from './components/TopNav';
import { SectionsView, TilesView, FolderPageView } from './components/views';
import { useMarquee } from './interaction/useMarquee';
import { useDragWiring } from './interaction/useDragWiring';
import { useWorkspaceShortcut } from './interaction/useWorkspaceShortcut';
import { useKeyboardNav, useDeleteShortcut } from './interaction/useKeyboardNav';
import { useQuickAddShortcuts } from './interaction/useQuickAddShortcuts';
import { applyAccent, applyDensity, resolveThemeAttr } from './lib/accent';
import { createBookmark, getBookmarkTree, getBookmarkUsage, moveBookmark, patchSettings, recordBookmarkUse, removeBookmark } from './lib/messaging';
import { useBlobUrl } from './lib/useBlobUrl';
import { useScrollCollapsed } from './lib/useScrollCollapsed';
import { normalizeBookmarkUrl } from './lib/url';
import { resolveDockMode } from './lib/dock-mode';
import { effectiveViewSort } from './lib/effective-view-sort';
import { prefetchAllIcons } from './lib/icon-prefetch';
import { findFolder, findNode, findParentFolder, isFolder, resolveRootFolder, sortChildren } from './lib/tree';
import { captureMoveSnapshots, restoreMoveSnapshots } from './lib/move-snapshot';
import { MAX_WORKSPACES } from '../shared/constants';
import { markOnboardingCompleted, defaultWorkspaceSettings, readWorkspaceWallpaper } from '../shared/storage';
import { useWorkspaceActions } from './state/useWorkspaceActions';
import { useSelection } from './state/useSelection';
import { useContextMenuBuilder } from './state/useContextMenuBuilder';
import { useToasts } from './state/useToasts';
import { ToastHost } from './components/ToastHost';

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
  const { toasts, pushToast, dismissToast } = useToasts();

  const activeWorkspace = useMemo(
    () => workspaces.find(w => w.id === settings.activeWorkspaceId) ?? workspaces[0] ?? null,
    [workspaces, settings.activeWorkspaceId],
  );

  // View + sort are per-workspace (WorkspaceRecord). Derive the effective values
  // for the active workspace, falling back to grid/manual/asc when none is active.
  const { folderMode, bookmarkSortMode, bookmarkSortDirection } = useMemo(
    () => effectiveViewSort(activeWorkspace),
    [activeWorkspace?.folderMode, activeWorkspace?.bookmarkSortMode, activeWorkspace?.bookmarkSortDirection],
  );

  const orderedWorkspaces = useMemo<WorkspaceRecord[]>(() => {
    const order = settings.workspaceOrder;
    if (!order || order.length === 0) return workspaces;
    const map = new Map(workspaces.map(w => [w.id, w]));
    const sorted = order.map(id => map.get(id)).filter((w): w is WorkspaceRecord => w != null);
    const inOrder = new Set(order);
    const rest = workspaces.filter(w => !inOrder.has(w.id));
    return [...sorted, ...rest];
  }, [workspaces, settings.workspaceOrder]);

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
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceSettingsInitialSection, setWorkspaceSettingsInitialSection] = useState<WorkspaceSectionId>('appearance');
  const [appSettingsInitialSection, setAppSettingsInitialSection] = useState<AppSectionId>('navigation');
  const [renameWorkspaceTarget, setRenameWorkspaceTarget] = useState<WorkspaceRecord | null>(null);
  const [confirmDeleteWorkspace, setConfirmDeleteWorkspace] = useState<WorkspaceRecord | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(initialOnboardOpen ?? false);
  const [newWorkspaceOpen, setNewWorkspaceOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const isScrolled = useScrollCollapsed();
  const [folderPath, setFolderPath] = useState<BookmarkNode[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<BookmarkNode | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState<string[] | null>(null);

  // Keyboard navigation: tracks which tile is currently focused via arrow keys.
  // Null = no keyboard focus (focus model resumes from real :focus or :focus-visible).
  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLElement | null>(null);
  const dragEngagedRef = useRef(false);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const [appEl, setAppEl] = useState<HTMLElement | null>(null);
  const [overlayBodyEl, setOverlayBodyEl] = useState<HTMLElement | null>(null);
  const [dockEl, setDockEl] = useState<HTMLElement | null>(null);

  const rootFolder = useMemo(
    () => resolveRootFolder(tree, activeWorkspace?.rootFolderId ?? ''),
    [tree, activeWorkspace?.rootFolderId],
  );

  // Apply tweaks → CSS variables. Accent foreground tokens (--accent-contrast,
  // --accent-on-surface) are theme-aware, so recompute on theme change too.
  useEffect(() => {
    if (activeWorkspace) {
      applyAccent(activeWorkspace.accentColor, resolveThemeAttr(activeWorkspace.themeMode ?? settings.themeMode));
    }
  }, [activeWorkspace?.accentColor, activeWorkspace?.themeMode, settings.themeMode]);

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
    document.documentElement.dataset.theme = resolveThemeAttr(activeWorkspace?.themeMode ?? settings.themeMode);
  }, [activeWorkspace?.themeMode, settings.themeMode]);

  useEffect(() => {
    let cancelled = false;
    getBookmarkUsage().then(u => { if (!cancelled) setUsage(u); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    prefetchAllIcons(tree);
  }, [tree]);

  const handlePatch = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...patch }));
    try {
      const next = await patchSettings(patch);
      // Only merge back the fields we sent — don't clobber in-flight optimistic updates for other fields.
      const keys = Object.keys(patch) as (keyof AppSettings)[];
      setSettings(prev => ({ ...prev, ...Object.fromEntries(keys.map(k => [k, next[k]])) }));
    } catch {
      // keep optimistic value
    }
  }, []);

  const openAppSettings = useCallback((section: AppSectionId = 'navigation') => {
    setWorkspaceSettingsOpen(false);
    setAppSettingsInitialSection(section);
    setAppSettingsOpen(true);
  }, []);

  const openWorkspaceSettings = useCallback((section: WorkspaceSectionId = 'appearance') => {
    setAppSettingsOpen(false);
    setWorkspaceSettingsInitialSection(section);
    setWorkspaceSettingsOpen(true);
  }, []);

  const refreshTree = useCallback(async () => {
    try {
      const t = await getBookmarkTree();
      setTree(t);
    } catch {
      // ignore
    }
  }, []);

  // Delete a single bookmark with an Undo affordance. Captures the original
  // parent + position so Undo re-creates it where it was. Failure surfaces a toast.
  const handleDeleteBookmark = useCallback(async (item: BookmarkNode) => {
    const parent = item.parentId ? findFolder(tree, item.parentId) : null;
    const idx = parent?.children?.findIndex(c => c.id === item.id) ?? -1;
    const snapshot = {
      parentId: item.parentId,
      title: item.title,
      url: item.url,
      index: idx >= 0 ? idx : undefined,
    };
    try {
      await removeBookmark(item.id);
      await refreshTree();
      pushToast({
        kind: 'info',
        message: `Deleted “${item.title}”`,
        action: snapshot.parentId
          ? {
              label: 'Undo',
              onClick: () => {
                void (async () => {
                  try {
                    await createBookmark(snapshot.parentId!, snapshot.title, snapshot.url, snapshot.index);
                    await refreshTree();
                  } catch {
                    pushToast({ kind: 'error', message: 'Couldn’t restore the bookmark.' });
                  }
                })();
              },
            }
          : undefined,
      });
    } catch {
      pushToast({ kind: 'error', message: `Couldn’t delete “${item.title}”.` });
    }
  }, [tree, refreshTree, pushToast]);

  const sortedChildren = useCallback((children?: BookmarkNode[]) => {
    if (!children) return [];
    return sortChildren(children, bookmarkSortMode, bookmarkSortDirection, usage);
  }, [bookmarkSortMode, bookmarkSortDirection, usage]);

  const sortedRootChildren = useMemo(() => sortedChildren(rootFolder?.children), [rootFolder, sortedChildren]);
  const sortedCurrentFolder: BookmarkNode | null = folderPath.length > 0
    ? { ...folderPath[folderPath.length - 1], children: sortedChildren(folderPath[folderPath.length - 1].children) }
    : null;
  const isAtRoot = folderPath.length === 0;

  // Flat list of currently navigable tiles in render order — drives arrow key navigation.
  // Sections view flattens across all section grids; folder-page view uses current folder.
  const navItems = useMemo<BookmarkNode[]>(() => {
    if (!isAtRoot && sortedCurrentFolder) return sortedCurrentFolder.children ?? [];
    if (folderMode === 'list') {
      const out: BookmarkNode[] = [];
      for (const folder of sortedRootChildren.filter(isFolder)) {
        for (const child of folder.children ?? []) out.push(child);
      }
      return out;
    }
    const folders = sortedRootChildren.filter(isFolder);
    const bookmarks = sortedRootChildren.filter(c => !isFolder(c));
    return [...folders, ...bookmarks];
  }, [isAtRoot, sortedCurrentFolder, sortedRootChildren, folderMode]);

  const dockItems = useMemo<BookmarkNode[]>(() => {
    if (!settings.showDock) return [];
    if (settings.dockFolderId) {
      const folder = findFolder(tree, settings.dockFolderId);
      if (folder) return (folder.children ?? []).slice(0, 8);
    }
    return (rootFolder?.children ?? []).slice(0, 8);
  }, [tree, settings.showDock, settings.dockFolderId, rootFolder]);

  const dockMode = resolveDockMode(settings.showDock, settings.autoHideDock);

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
    const url = normalizeBookmarkUrl(item.url);
    const newTab = settings.openLinksInNewTab !== Boolean(event?.metaKey || event?.ctrlKey);
    if (newTab) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
  }, [settings.openLinksInNewTab]);

  const { selection, setSelection, selectionRef, handleTileClick } = useSelection({
    navItems,
    rootFolder,
    dragEngagedRef,
    handlePickFolder,
    handlePickBookmark,
  });

  const {
    handleSwitchWorkspace,
    handlePatchWorkspace,
    handleSetWorkspaceWallpaper,
    handleCreateWorkspace,
    handleDeleteWorkspace,
    handleDuplicateWorkspace,
    handleAddWorkspace,
    handleReorderWorkspaces,
    handleRenameWorkspace,
  } = useWorkspaceActions({
    workspaces,
    setWorkspaces,
    activeWorkspace,
    settings,
    setSettings,
    setNewWorkspaceOpen,
    setWorkspaceWallpaper,
    setIsSwitching,
    setFolderPath,
    setSelection,
    handlePatch,
  });


  const handleGoToCrumb = useCallback((idx: number) => setFolderPath(p => p.slice(0, idx)), []);

  const sortChoice = settingsToSortValue(bookmarkSortMode, bookmarkSortDirection);

  const handleSortChange = useCallback((choice: SortChoice) => {
    void handlePatchWorkspace({ bookmarkSortMode: choice.mode, bookmarkSortDirection: choice.direction });
  }, [handlePatchWorkspace]);

  const handleToggleViewMode = useCallback(() => {
    void handlePatchWorkspace({ folderMode: folderMode === 'grid' ? 'list' : 'grid' });
  }, [folderMode, handlePatchWorkspace]);

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


  const handleRenameFolder = useCallback((folder: BookmarkNode) => {
    setFolderNameTarget({ mode: 'rename', id: folder.id, title: folder.title });
  }, []);

  const handleEditBookmark = useCallback((item: BookmarkNode) => {
    setEditTarget({ id: item.id, parentId: item.parentId, title: item.title, url: item.url ?? '' });
  }, []);

  // Multi-select → "Move N to new folder": open the create-folder dialog carrying
  // the selected ids; the move happens once the folder exists (see onSaved below).
  // The folder lands in the selection's own scope so it appears in the current view.
  const handleMoveSelectionToNewFolder = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setFolderNameTarget({ mode: 'create', parentId: selection.scopeFolderId || defaultParentId(), moveIds: ids });
  }, [selection.scopeFolderId, defaultParentId]);

  const { buildContextMenuItems, handleOpenAddMenu, handleWorkspaceContextMenu, handleCanvasContextMenu } = useContextMenuBuilder({
    tree,
    rootFolder,
    workspaces,
    selection,
    setContextMenu,
    defaultParentId,
    handleNewBookmark,
    handleNewFolder,
    handleAddWorkspace,
    handlePickFolder,
    handlePickBookmark,
    handleEditBookmark,
    handleRenameFolder,
    handleDuplicateWorkspace,
    openWorkspaceSettings,
    openAppSettings,
    setConfirmDeleteFolder,
    setConfirmDeleteBatch,
    onMoveSelectionToNewFolder: handleMoveSelectionToNewFolder,
    setRenameWorkspaceTarget,
    setConfirmDeleteWorkspace,
    onDeleteBookmark: handleDeleteBookmark,
  });

  const searchIndex = useMemo(() => buildSearchIndex(tree, workspaces), [tree, workspaces]);

  const onPickSearchBookmark = useCallback((r: FlatSearchResult) => {
    if (!r.url) return;
    handlePickBookmark({ id: r.id, title: r.title, url: r.url });
  }, [handlePickBookmark]);

  const onPickSearchFolder = useCallback((r: FlatSearchResult) => {
    const folder = findFolder(tree, r.id);
    if (folder) handlePickFolder(folder);
  }, [tree, handlePickFolder]);

  useWorkspaceShortcut(orderedWorkspaces, handleSwitchWorkspace);

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

  const handleReorderBlocked = useCallback(() => {
    pushToast({ kind: 'info', message: 'Switch to Manual sort to reorder tiles.' });
  }, [pushToast]);

  const { dragPreview, dragEnabled } = useDragWiring({
    canvasEl,
    overlayBodyEl,
    dockEl,
    rootFolder,
    settings,
    bookmarkSortMode,
    workspaces,
    tree,
    sortedChildren,
    selectionRef,
    setSelection,
    refreshTree,
    dragEngagedRef,
    onSwitchWorkspace: handleSwitchWorkspace,
    onReorderBlocked: handleReorderBlocked,
    pushToast,
  });

  const handleDeleteFocused = useCallback(async (item: BookmarkNode) => {
    if (isFolder(item)) {
      setConfirmDeleteFolder(item);
      return;
    }
    await handleDeleteBookmark(item);
  }, [handleDeleteBookmark]);

  // Arrow-key grid navigation. Active only when no dialog/overlay/input has focus —
  // otherwise we'd hijack typing or contend with active surfaces.
  const anyOverlayOpen = Boolean(
    appSettingsOpen || workspaceSettingsOpen || renameWorkspaceTarget || confirmDeleteWorkspace || editTarget || quickAddTarget || folderNameTarget || onboardOpen
    || newWorkspaceOpen || confirmDeleteFolder || confirmDeleteBatch || openFolderId || contextMenu,
  );

  useKeyboardNav({
    enabled: !anyOverlayOpen,
    navItems,
    focusedTileId,
    setFocusedTileId,
    canvasEl,
    onPickFolder: handlePickFolder,
    onPickBookmark: handlePickBookmark,
    buildContextMenuItems,
    setContextMenu,
  });

  useDeleteShortcut({
    enabled: !anyOverlayOpen,
    selection,
    focusedTileId,
    navItems,
    onBatchDelete: (ids) => setConfirmDeleteBatch(ids),
    onDeleteFocused: (item) => { void handleDeleteFocused(item); },
  });

  // Single-key quick-add shortcuts — only when no overlay is open
  const handleOpenNewWorkspace = useCallback(() => {
    if (workspaces.length >= MAX_WORKSPACES) return;
    setNewWorkspaceOpen(true);
  }, [workspaces.length]);

  const folderSiblingNames = useMemo<string[]>(() => {
    if (!folderNameTarget) return [];
    const parent = folderNameTarget.mode === 'create'
      ? findFolder(tree, folderNameTarget.parentId)
      : findParentFolder(tree, folderNameTarget.id);
    const selfId = folderNameTarget.mode === 'rename' ? folderNameTarget.id : null;
    return (parent?.children ?? [])
      .filter(isFolder)
      .filter(f => f.id !== selfId)
      .map(f => f.title);
  }, [folderNameTarget, tree]);
  useQuickAddShortcuts({
    enabled: !anyOverlayOpen,
    selection,
    tree,
    onNewBookmark: handleNewBookmark,
    onNewFolder: handleNewFolder,
    onNewWorkspace: handleOpenNewWorkspace,
    onRenameFolder: handleRenameFolder,
    onEditBookmark: handleEditBookmark,
  });

  const wallpaperBlobUrl = useBlobUrl(workspaceWallpaper);
  const tileShape = activeWorkspace?.tileShape ?? 'squircle';

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
      data-tile-shape={tileShape}
      data-labels={String(activeWorkspace?.showTileLabels ?? true)}
      data-dock={dockMode}
      data-switching={isSwitching || undefined}
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
          workspaces={orderedWorkspaces}
          activeWorkspaceId={settings.activeWorkspaceId}
          onSwitchWorkspace={handleSwitchWorkspace}
          onWorkspaceContextMenu={handleWorkspaceContextMenu}
          onReorderWorkspaces={handleReorderWorkspaces}
          onOpenAddMenu={handleOpenAddMenu}
          path={folderPath}
          onCrumb={handleGoToCrumb}
          sortValue={sortChoice}
          onSort={handleSortChange}
          folderMode={folderMode}
          onToggleViewMode={handleToggleViewMode}
          onOpenAppSettings={() => openAppSettings()}
          onOpenWorkspaceSettings={() => openWorkspaceSettings('appearance')}
        />
      </header>

      {(settings.showClock || settings.showSearchBar) && (
        <section className="ff-hero">
          {settings.showClock && <ClockGreeting hourFormat={settings.clockHourFormat} />}
          {settings.showSearchBar && !isScrolled && (
            <HeroSearch
              shape={tileShape}
              index={searchIndex}
              usage={usage}
              activeWorkspaceId={settings.activeWorkspaceId}
              onPickBookmark={onPickSearchBookmark}
              onPickFolder={onPickSearchFolder}
            />
          )}
        </section>
      )}
      {(!settings.showSearchBar || isScrolled) && (
        <HeroSearch
          shape={tileShape}
          index={searchIndex}
          usage={usage}
          activeWorkspaceId={settings.activeWorkspaceId}
          onPickBookmark={onPickSearchBookmark}
          onPickFolder={onPickSearchFolder}
          overlayMode
        />
      )}

      <main className="ff-canvas" ref={(el) => { canvasRef.current = el; setCanvasEl(el); }}>
        {!isAtRoot && sortedCurrentFolder ? (
          <FolderPageView
            folder={sortedCurrentFolder}
            shape={tileShape}
            onPickFolder={handleTileClick}
            onPickItem={handleTileClick}
            selectedIds={selection.ids}
            selectionScopeFolderId={selection.scopeFolderId}
            focusedTileId={focusedTileId}
          />
        ) : folderMode === 'list' ? (
          <SectionsView
            tree={sortedRootChildren.filter(isFolder)}
            rootBookmarks={sortedRootChildren.filter(c => !isFolder(c))}
            scopeFolderId={rootFolder?.id ?? ''}
            shape={tileShape}
            dragEnabled={dragEnabled}
            onEmptyAdd={() => handleNewBookmark()}
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
            shape={tileShape}
            onEmptyAdd={() => handleNewBookmark()}
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
        shape={tileShape}
        dockFolderId={settings.dockFolderId || rootFolder?.id || ''}
        onItemClick={handlePickBookmark}
        onFolderClick={handlePickFolder}
        surfaceRef={setDockEl}
      />

      {openFolder && (
        <FolderOverlay
          folder={openFolder}
          rootFolderId={rootFolder?.id ?? ''}
          shape={tileShape}
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
          onDeleteFocused={(item) => { void handleDeleteFocused(item); }}
          onBatchDelete={(ids) => setConfirmDeleteBatch(ids)}
          onEditId={(id) => {
            const node = findNode(tree, id);
            if (!node) return;
            if (isFolder(node)) handleRenameFolder(node);
            else handleEditBookmark(node);
          }}
          onNewWorkspace={() => setNewWorkspaceOpen(true)}
          buildContextMenuItems={buildContextMenuItems}
          setContextMenu={setContextMenu}
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
          siblingNames={folderSiblingNames}
          onClose={() => setFolderNameTarget(null)}
          onSaved={async (folder) => {
            const moveIds = folderNameTarget.mode === 'create' ? folderNameTarget.moveIds : undefined;
            setFolderNameTarget(null);
            if (moveIds && moveIds.length > 0) {
              // Capture origins before relocating so Undo can replay each item
              // back to its parent + index (the new folder is empty at this point).
              const snapshots = captureMoveSnapshots(tree, moveIds);
              try {
                // Sequential to preserve selection order in the new folder.
                for (const id of moveIds) await moveBookmark(id, folder.id);
                setSelection({ ids: new Set(moveIds), scopeFolderId: folder.id });
                pushToast({
                  kind: 'info',
                  message: `Moved ${moveIds.length} ${moveIds.length === 1 ? 'item' : 'items'} to “${folder.title}”.`,
                  action: snapshots.length > 0
                    ? {
                        label: 'Undo',
                        onClick: () => {
                          void (async () => {
                            try {
                              // Restore items to origin, then remove the now-empty new folder.
                              await restoreMoveSnapshots(snapshots, moveBookmark);
                              await removeBookmark(folder.id, true);
                              await refreshTree();
                            } catch {
                              pushToast({ kind: 'error', message: 'Couldn’t undo the move.' });
                            }
                          })();
                        },
                      }
                    : undefined,
                });
              } catch {
                pushToast({ kind: 'error', message: 'Couldn’t move the selected bookmarks.' });
              }
            }
            await refreshTree();
          }}
        />
      )}

      {newWorkspaceOpen && (
        <NewWorkspaceDialog
          tree={tree}
          workspaces={workspaces}
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

      {appSettingsOpen && (
        <AppSettingsDrawer
          settings={settings}
          tree={tree}
          initialSection={appSettingsInitialSection}
          onPatchGlobal={handlePatch}
          onAfterImport={(next: AppSettings) => { setSettings(next); refreshTree(); }}
          onClose={() => { setAppSettingsOpen(false); setAppSettingsInitialSection('navigation'); }}
        />
      )}

      {workspaceSettingsOpen && (
        <WorkspaceSettingsDrawer
          settings={settings}
          activeWorkspace={activeWorkspace}
          workspaceWallpaper={workspaceWallpaper}
          initialSection={workspaceSettingsInitialSection}
          onPatchGlobal={handlePatch}
          onPatchWorkspace={handlePatchWorkspace}
          onSetWorkspaceWallpaper={handleSetWorkspaceWallpaper}
          onClose={() => { setWorkspaceSettingsOpen(false); setWorkspaceSettingsInitialSection('appearance'); }}
        />
      )}

      {renameWorkspaceTarget && (
        <WorkspaceRenameDialog
          workspace={renameWorkspaceTarget}
          onRename={handleRenameWorkspace}
          onSaved={() => setRenameWorkspaceTarget(null)}
          onClose={() => setRenameWorkspaceTarget(null)}
        />
      )}

      {confirmDeleteWorkspace && (
        <ConfirmDeleteWorkspaceDialog
          workspace={confirmDeleteWorkspace}
          onClose={() => setConfirmDeleteWorkspace(null)}
          onConfirm={async () => {
            await handleDeleteWorkspace(confirmDeleteWorkspace.id);
            setConfirmDeleteWorkspace(null);
          }}
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

      {settings.showClock && <ClockMini hourFormat={settings.clockHourFormat} />}

      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
