import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppSettings, BookmarkNode, BookmarkSortMode, SortDirection } from '../shared/messages';
import { ContextMenu, type ContextMenuItem } from './components/ContextMenu';
import { Dock } from './components/Dock';
import { EditDialog, type EditTarget } from './components/EditDialog';
import { FolderOverlay } from './components/FolderOverlay';
import { buildSearchIndex, ClockGreeting, HeroSearch, type FlatSearchResult } from './components/HeroSearch';
import { Ico } from './components/Ico';
import { Onboarding } from './components/Onboarding';
import { SettingsDrawer } from './components/settings';
import { SectionsView, TilesView, FolderPageView } from './components/views';
import { applyAccent, applyDensity, resolveThemeAttr } from './lib/accent';
import { getBookmarkTree, getSettings, patchSettings, removeBookmark } from './lib/messaging';
import { findFolder, isFolder, resolveRootFolder, sortChildren } from './lib/tree';

interface AppProps {
  initialSettings: AppSettings;
  initialTree: BookmarkNode[];
}

function settingsToSortValue(mode: BookmarkSortMode, direction: SortDirection): string {
  if (mode === 'manual') return 'manual';
  return `${mode}:${direction}`;
}

function parseSortValue(value: string): { mode: BookmarkSortMode; direction: SortDirection } {
  if (value === 'manual') return { mode: 'manual', direction: 'asc' };
  const [mode, direction] = value.split(':') as [BookmarkSortMode, SortDirection];
  return { mode, direction };
}

export function App({ initialSettings, initialTree }: AppProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [tree, setTree] = useState(initialTree);

  const [openFolder, setOpenFolder] = useState<BookmarkNode | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [folderPath, setFolderPath] = useState<BookmarkNode[]>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const rootFolder = useMemo(() => resolveRootFolder(tree, settings.rootFolderId), [tree, settings.rootFolderId]);

  // Apply tweaks → CSS variables
  useEffect(() => { applyAccent(settings.accentColor); }, [settings.accentColor]);
  useEffect(() => { applyDensity(settings.layoutPreset); }, [settings.layoutPreset]);
  useEffect(() => {
    document.documentElement.dataset.theme = resolveThemeAttr(settings.themeMode);
  }, [settings.themeMode]);

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
    return sortChildren(children, settings.bookmarkSortMode, settings.bookmarkSortDirection);
  }, [settings.bookmarkSortMode, settings.bookmarkSortDirection]);

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
      setOpenFolder(folder);
    }
  }, [settings.folderOpenMode]);

  const handlePickBookmark = useCallback((item: BookmarkNode, event?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    if (!item.url) return;
    const url = item.url.startsWith('http') ? item.url : `https://${item.url}`;
    const newTab = settings.openLinksInNewTab !== Boolean(event?.metaKey || event?.ctrlKey);
    if (newTab) window.open(url, '_blank', 'noopener');
    else window.location.href = url;
  }, [settings.openLinksInNewTab]);

  const handleGoToCrumb = useCallback((idx: number) => setFolderPath(p => p.slice(0, idx)), []);

  const sortChoice = settingsToSortValue(settings.bookmarkSortMode, settings.bookmarkSortDirection);

  const handleSortChange = useCallback(({ value }: { value: string }) => {
    const parsed = parseSortValue(value);
    handlePatch({ bookmarkSortMode: parsed.mode, bookmarkSortDirection: parsed.direction });
  }, [handlePatch]);

  const handleNewBookmark = useCallback(() => {
    const parentId = isAtRoot ? (rootFolder?.id ?? '') : folderPath[folderPath.length - 1].id;
    setEditTarget({ parentId, title: 'New bookmark', url: 'https://' });
  }, [isAtRoot, rootFolder, folderPath]);

  const handleEditBookmark = useCallback((item: BookmarkNode) => {
    setEditTarget({ id: item.id, parentId: item.parentId, title: item.title, url: item.url ?? '' });
  }, []);

  const buildContextMenuItems = useCallback((target: BookmarkNode | null): ContextMenuItem[] => {
    if (target == null) {
      return [
        { kind: 'item', icon: 'plus',       label: 'New bookmark', onClick: handleNewBookmark },
        { kind: 'item', icon: 'folderPlus', label: 'New folder',   disabled: true, onClick: () => {} },
        { kind: 'separator' },
        { kind: 'item', icon: 'refresh',    label: 'Refresh icons', onClick: () => refreshTree() },
      ];
    }
    if (isFolder(target)) {
      return [
        { kind: 'item', icon: 'folder',     label: 'Open folder', kbd: '↵', onClick: () => handlePickFolder(target) },
        { kind: 'item', icon: 'pencil',     label: 'Rename',      disabled: true, onClick: () => {} },
        { kind: 'separator' },
        { kind: 'item', icon: 'plus',       label: 'New bookmark inside',
          onClick: () => setEditTarget({ parentId: target.id, title: 'New bookmark', url: 'https://' }) },
        { kind: 'item', icon: 'folderPlus', label: 'New folder inside', disabled: true, onClick: () => {} },
        { kind: 'separator' },
        { kind: 'item', icon: 'trash', label: 'Delete folder', kbd: '⌫', destructive: true,
          onClick: async () => { await removeBookmark(target.id, true); refreshTree(); } },
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
  }, [handleEditBookmark, handleNewBookmark, handlePickBookmark, handlePickFolder, refreshTree]);

  const handleCanvasContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const target = event.target as HTMLElement;
    const tileEl = target.closest('.ff-tile') as HTMLElement | null;
    let menuTarget: BookmarkNode | null = null;
    if (tileEl?.dataset.itemId) {
      const id = tileEl.dataset.itemId;
      const walk = (nodes: BookmarkNode[]): BookmarkNode | null => {
        for (const n of nodes) {
          if (n.id === id) return n;
          if (n.children) {
            const r = walk(n.children);
            if (r) return r;
          }
        }
        return null;
      };
      menuTarget = walk(tree);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, items: buildContextMenuItems(menuTarget) });
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
        <nav className="ff-nav" aria-label="Workspace">
          <div className="ff-nav__left">
            <button className="ff-iconbtn" aria-label="Home" onClick={() => handleGoToCrumb(0)}>
              <Ico name="home" size={16} />
              <span>Home</span>
            </button>
          </div>
          <div className="ff-nav__center">
            <div className="ff-crumb">
              {isAtRoot ? (
                <span className="ff-crumb__here">{rootFolder?.title ?? 'My bookmarks'}</span>
              ) : (
                <>
                  <button className="ff-crumb__btn" onClick={() => handleGoToCrumb(0)}>{rootFolder?.title ?? 'My bookmarks'}</button>
                  {folderPath.map((f, i) => (
                    <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <Ico name="chevronRight" size={11} className="ff-crumb__sep" />
                      {i === folderPath.length - 1 ? (
                        <span className="ff-crumb__here">{f.title}</span>
                      ) : (
                        <button className="ff-crumb__btn" onClick={() => handleGoToCrumb(i + 1)}>{f.title}</button>
                      )}
                    </span>
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="ff-nav__right">
            <SortPill
              value={sortChoice}
              onChange={handleSortChange}
            />
            <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Add bookmark" onClick={handleNewBookmark}>
              <Ico name="plus" size={16} />
            </button>
            <button className="ff-iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Settings">
              <Ico name="settings" size={16} />
              <span>Settings</span>
            </button>
          </div>
        </nav>
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

      <main className="ff-canvas" onContextMenu={handleCanvasContextMenu}>
        {!isAtRoot && sortedCurrentFolder ? (
          <FolderPageView
            folder={sortedCurrentFolder}
            shape={settings.tileShape}
            onPickFolder={handlePickFolder}
            onPickItem={handleEditBookmark}
          />
        ) : settings.folderMode === 'sections' ? (
          <SectionsView
            tree={sortedRootChildren.filter(isFolder)}
            shape={settings.tileShape}
            onPickFolder={handlePickFolder}
            onPickItem={handleEditBookmark}
            onAdd={(folder) => setEditTarget({ parentId: folder.id, title: 'New bookmark', url: 'https://' })}
          />
        ) : (
          <TilesView
            tree={sortedRootChildren.filter(isFolder)}
            shape={settings.tileShape}
            onPickFolder={handlePickFolder}
            onPickItem={handleEditBookmark}
          />
        )}
      </main>

      <Dock items={dockItems} mode={dockMode} shape={settings.tileShape} onItemClick={handlePickBookmark} />

      {openFolder && (
        <FolderOverlay
          folder={openFolder}
          shape={settings.tileShape}
          onClose={() => setOpenFolder(null)}
          onEdit={(item) => { setOpenFolder(null); handleEditBookmark(item); }}
        />
      )}

      {editTarget && (
        <EditDialog
          target={editTarget}
          shape={settings.tileShape}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); refreshTree(); }}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          tree={tree}
          onPatch={handlePatch}
          onClose={() => setSettingsOpen(false)}
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
        onClick={() => setOnboardOpen(true)}
        title="Replay onboarding"
        aria-label="Replay onboarding"
        style={{
          position: 'fixed', left: 16, bottom: 16, zIndex: 40,
          width: 38, height: 38, borderRadius: 12,
          background: 'var(--ink-2)', border: '1px solid var(--line-1)',
          color: 'var(--fg-3)', cursor: 'pointer',
          display: 'grid', placeItems: 'center',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <Ico name="zap" size={16} />
      </button>
    </div>
  );
}

interface SortPillProps {
  value: string;
  onChange: (choice: { value: string }) => void;
}

const SORT_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'name:asc', label: 'Name (A → Z)' },
  { value: 'name:desc', label: 'Name (Z → A)' },
  { value: 'lastUsed:desc', label: 'Last used' },
  { value: 'created:desc', label: 'Date added (newest)' },
  { value: 'created:asc', label: 'Date added (oldest)' },
];

function SortPill({ value, onChange }: SortPillProps) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find(o => o.value === value)?.label ?? 'Manual';

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.ff-sort')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ff-sort">
      <button className="ff-pill" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Ico name="sort" size={14} />
        <span>{current}</span>
        <Ico name="chevronDown" size={12} />
      </button>
      {open && (
        <ul className="ff-sort__panel" role="listbox">
          {SORT_OPTIONS.map(o => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className="ff-sort__option"
              data-active={o.value === value}
              onClick={() => { onChange(o); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.value === value && <Ico name="check" size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
