import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, BookmarkNode, BookmarkSortMode, SortDirection } from '../shared/messages';
import { ConfirmDeleteDialog } from './components/ConfirmDeleteDialog';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { Dock } from './components/Dock';
import { EditDialog, type EditTarget } from './components/EditDialog';
import { FolderNameDialog, type FolderNameDialogTarget } from './components/FolderNameDialog';
import { FolderOverlay } from './components/FolderOverlay';
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
import { getBookmarkTree, getBookmarkUsage, getSettings, moveBookmark, patchSettings, recordBookmarkUse, removeBookmark } from './lib/messaging';
import { findFolder, findNode, isFolder, resolveRootFolder, sortChildren } from './lib/tree';

interface AppProps {
  initialSettings: AppSettings;
  initialTree: BookmarkNode[];
}

function settingsToSortValue(mode: BookmarkSortMode, direction: SortDirection): string {
  if (mode === 'manual') return 'manual';
  return `${mode}:${direction}`;
}

export function App({ initialSettings, initialTree }: AppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [tree, setTree] = useState(initialTree);
  const [usage, setUsage] = useState<Record<string, number>>({});

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const openFolder = useMemo(
    () => (openFolderId ? findFolder(tree, openFolderId) ?? null : null),
    [tree, openFolderId],
  );
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [quickAddTarget, setQuickAddTarget] = useState<{ parentId: string; parentTitle?: string } | null>(null);
  const [folderNameTarget, setFolderNameTarget] = useState<FolderNameDialogTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<BookmarkNode[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<BookmarkNode | null>(null);

  const [selection, setSelection] = useState<MarqueeSelection>({ ids: new Set(), scopeFolderId: '' });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  const canvasRef = useRef<HTMLElement | null>(null);
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  const [overlayBodyEl, setOverlayBodyEl] = useState<HTMLElement | null>(null);

  const rootFolder = useMemo(() => resolveRootFolder(tree, settings.rootFolderId), [tree, settings.rootFolderId]);

  // Apply tweaks → CSS variables
  useEffect(() => { applyAccent(settings.accentColor); }, [settings.accentColor]);
  useEffect(() => { applyDensity(settings.layoutPreset); }, [settings.layoutPreset]);
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

  const dockItems = useMemo<BookmarkNode[]>(() => {
    if (!settings.showDock) return [];
    if (settings.dockFolderId) {
      const folder = findFolder(tree, settings.dockFolderId);
      if (folder) return (folder.children ?? []).filter(c => !isFolder(c)).slice(0, 8);
    }
    return (rootFolder?.children ?? []).filter(c => !isFolder(c)).slice(0, 8);
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
      return [
        { kind: 'item', icon: 'plus',       label: `New bookmark${labelSuffix}`, onClick: () => handleNewBookmark(parentId, sectionFolder?.title) },
        { kind: 'item', icon: 'folderPlus', label: `New folder${labelSuffix}`,
          onClick: () => handleNewFolder(parentId, sectionFolder?.title) },
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
        { kind: 'item', icon: 'trash', label: 'Delete folder', kbd: '⌫', destructive: true,
          onClick: () => setConfirmDeleteFolder(target) },
      ];
    }
    return [
      { kind: 'item', icon: 'link',       label: 'Open',            kbd: '↵',  onClick: () => handlePickBookmark(target) },
      { kind: 'item', icon: 'arrowRight', label: 'Open in new tab', kbd: '⌘↵', onClick: () => target.url && window.open(target.url.startsWith('http') ? target.url : `https://${target.url}`, '_blank', 'noopener') },
      { kind: 'item', icon: 'copy',       label: 'Copy URL',        kbd: '⌘C', onClick: () => target.url && navigator.clipboard?.writeText(target.url.startsWith('http') ? target.url : `https://${target.url}`) },
      { kind: 'separator' },
      { kind: 'item', icon: 'pencil',     label: 'Edit…',           onClick: () => handleEditBookmark(target) },
      { kind: 'separator' },
      { kind: 'item', icon: 'trash',      label: 'Delete',          kbd: '⌫', destructive: true,
        onClick: async () => { await removeBookmark(target.id); refreshTree(); } },
    ];
  }, [defaultParentId, handleEditBookmark, handleNewBookmark, handleNewFolder, handlePickBookmark, handlePickFolder, handleRenameFolder]);

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const tileEl = target.closest('.ff-tile') as HTMLElement | null;
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

  const searchIndex = useMemo(() => buildSearchIndex(rootFolder?.children ?? []), [rootFolder]);

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
      } else {
        // reorder — preserve drag-source order, increment index as we go for items moving forward in same parent
        let idx = target.index;
        for (const id of dragIds) {
          await moveBookmark(id, target.parentId, idx);
          idx += 1;
        }
      }
      // Drop selection scope if target moved away
      const moveTargetScope = target.kind === 'folder' ? target.folderId : target.kind === 'dock' ? (settings.dockFolderId || rootFolder?.id || '') : target.parentId;
      setSelection({ ids: new Set(dragIds), scopeFolderId: moveTargetScope });
    } finally {
      await refreshTree();
    }
  }, [refreshTree, rootFolder, settings.dockFolderId]);

  const dragEnabled = settings.bookmarkSortMode === 'manual';

  const marqueeRect = useMarquee({
    surface: canvasEl,
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
  });
  const overlayDragPreview = useDrag({
    surface: overlayBodyEl,
    rootFolderId: rootFolder?.id ?? '',
    enabled: dragEnabled,
    selectionRef,
    getOrderedChildren,
    onCommit: handleDragCommit,
  });
  const dragPreview = canvasDragPreview ?? overlayDragPreview;

  const handleTileClick = useCallback((item: BookmarkNode, event: React.MouseEvent) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const scope = (event.currentTarget as HTMLElement | null)?.closest<HTMLElement>('[data-scope-folder-id]')?.dataset.scopeFolderId ?? rootFolder?.id ?? '';
      setSelection(prev => {
        const sameScope = prev.scopeFolderId === scope;
        const baseIds = sameScope ? new Set(prev.ids) : new Set<string>();
        if (event.metaKey || event.ctrlKey) {
          if (baseIds.has(item.id)) baseIds.delete(item.id);
          else baseIds.add(item.id);
        } else {
          baseIds.add(item.id);
        }
        return { ids: baseIds, scopeFolderId: scope };
      });
      return;
    }
    // Plain click — clear selection. Folder/bookmark open behavior handled by caller.
    if (selectionRef.current.ids.size > 0) {
      setSelection({ ids: new Set(), scopeFolderId: '' });
    }
    if (isFolder(item)) handlePickFolder(item);
    else handlePickBookmark(item, event);
  }, [handlePickBookmark, handlePickFolder, rootFolder]);

  return (
    <div
      className="ff-app"
      data-bg={settings.backgroundMode}
      data-bg-style={settings.gradientStyle}
      data-tile-shape={settings.tileShape}
      data-labels={String(settings.showTileLabels)}
      data-dock={dockMode}
      style={settings.customBackgroundImage ? { ['--wallpaper-url' as string]: `url(${settings.customBackgroundImage})` } : undefined}
    >
      <header>
        <TopNav
          rootTitle={rootFolder?.title ?? 'My bookmarks'}
          path={folderPath}
          onCrumb={handleGoToCrumb}
          sortValue={sortChoice}
          onSort={handleSortChange}
          onOpenSettings={() => setSettingsOpen(true)}
          onAddBookmark={() => handleNewBookmark()}
        />
      </header>

      <section className="ff-hero">
        {settings.showClock && <ClockGreeting hourFormat={settings.clockHourFormat} />}
        {settings.showSearchBar && (
          <HeroSearch
            shape={settings.tileShape}
            index={searchIndex}
            onPickBookmark={onPickSearchBookmark}
            onPickFolder={onPickSearchFolder}
          />
        )}
      </section>

      <main className="ff-canvas" ref={(el) => { canvasRef.current = el; setCanvasEl(el); }} onContextMenu={handleCanvasContextMenu}>
        {!isAtRoot && sortedCurrentFolder ? (
          <FolderPageView
            folder={sortedCurrentFolder}
            shape={settings.tileShape}
            onPickFolder={handleTileClick}
            onPickItem={handleTileClick}
            selectedIds={selection.ids}
            selectionScopeFolderId={selection.scopeFolderId}
          />
        ) : settings.folderMode === 'sections' ? (
          <SectionsView
            tree={sortedRootChildren.filter(isFolder)}
            scopeFolderId={rootFolder?.id ?? ''}
            shape={settings.tileShape}
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
          />
        ) : (
          <TilesView
            tree={sortedRootChildren.filter(isFolder)}
            rootBookmarks={sortedRootChildren.filter(c => !isFolder(c))}
            scopeFolderId={rootFolder?.id ?? ''}
            shape={settings.tileShape}
            onPickFolder={handleTileClick}
            onPickItem={handleTileClick}
            selectedIds={selection.ids}
            selectionScopeFolderId={selection.scopeFolderId}
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

      <Dock items={dockItems} mode={dockMode} shape={settings.tileShape} onItemClick={handlePickBookmark} />

      {openFolder && (
        <FolderOverlay
          folder={openFolder}
          rootFolderId={rootFolder?.id ?? ''}
          shape={settings.tileShape}
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

      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          tree={tree}
          onPatch={handlePatch}
          onClose={() => setSettingsOpen(false)}
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
          onPatch={handlePatch}
          onFinish={() => setOnboardOpen(false)}
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
