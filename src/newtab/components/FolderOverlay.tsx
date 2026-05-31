import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkNode, TileShape } from '@/shared/messages';
import { findNode, isFolder } from '../lib/tree';
import { TileFor } from './Tile';
import { Ico } from './Ico';
import type { ContextMenuItem } from './ContextMenu';
import type { MarqueeRect } from '../interaction/useMarquee';
import { useDeleteShortcut, useKeyboardNav } from '../interaction/useKeyboardNav';

interface FolderOverlayProps {
  folder: BookmarkNode;
  rootFolderId: string;
  shape: TileShape;
  onClose: () => void;
  onPickBookmark: (item: BookmarkNode, event?: { metaKey?: boolean; ctrlKey?: boolean }) => void;
  onContextMenu?: (target: BookmarkNode, event: ReactMouseEvent) => void;
  onNewBookmark?: (parentId: string, parentTitle?: string) => void;
  onNewFolder?: (parentId: string, parentTitle?: string) => void;
  bodyRef?: (el: HTMLElement | null) => void;
  selectedIds?: ReadonlySet<string>;
  selectionScopeFolderId?: string;
  onTileSelect?: (item: BookmarkNode, event: ReactMouseEvent) => void;
  onClearSelection?: () => void;
  marqueeRect?: MarqueeRect | null;
  onDeleteFocused?: (item: BookmarkNode) => void;
  onBatchDelete?: (ids: string[]) => void;
  onEditId?: (id: string) => void;
  onNewWorkspace?: () => void;
  buildContextMenuItems?: (target: BookmarkNode | null) => ContextMenuItem[];
  setContextMenu?: (menu: { x: number; y: number; items: ContextMenuItem[] }) => void;
}

export function FolderOverlay({
  folder,
  rootFolderId,
  shape,
  onClose,
  onPickBookmark,
  onContextMenu,
  onNewBookmark,
  onNewFolder,
  bodyRef,
  selectedIds,
  selectionScopeFolderId,
  onTileSelect,
  onClearSelection,
  marqueeRect,
  onDeleteFocused,
  onBatchDelete,
  onEditId,
  onNewWorkspace,
  buildContextMenuItems,
  setContextMenu,
}: FolderOverlayProps) {
  const [stack, setStack] = useState<BookmarkNode[]>([folder]);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const [closing, setClosing] = useState(false);
  const current = stack[stack.length - 1];
  const suppressCloseRef = useRef(false);
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => onClose(), 200);
  }, [closing, onClose]);

  useEffect(() => {
    const onSuppress = () => { suppressCloseRef.current = true; };
    window.addEventListener('ff-suppress-overlay-close', onSuppress);
    return () => window.removeEventListener('ff-suppress-overlay-close', onSuppress);
  }, []);

  useEffect(() => {
    setStack(prev => {
      if (prev[0]?.id !== folder.id) {
        setDirection('forward');
        return [folder];
      }
      const next: BookmarkNode[] = [folder];
      for (let i = 1; i < prev.length; i++) {
        const refreshed = findNode([folder], prev[i].id);
        if (!refreshed) break;
        next.push(refreshed);
      }
      return next;
    });
  }, [folder]);

  // Reset focused tile when navigating between folders within the overlay.
  useEffect(() => { setFocusedTileId(null); }, [current.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleClose(); return; }
      const cmdBack = e.key === 'ArrowLeft' && (e.metaKey || e.ctrlKey);
      const backspaceBack = e.key === 'Backspace'
        && !focusedTileId
        && (!selectedIds || selectedIds.size === 0);
      if (cmdBack || backspaceBack) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active as HTMLElement).isContentEditable)) return;
        if (stack.length > 1) {
          setDirection('back');
          setStack(s => s.slice(0, -1));
        } else {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose, stack.length, focusedTileId, selectedIds]);

  const navItems = useMemo(() => current.children ?? [], [current]);

  const handleArrowPickFolder = useCallback((sub: BookmarkNode) => {
    setDirection('forward');
    setStack(s => [...s, sub]);
  }, []);

  const handleArrowPickBookmark = useCallback((item: BookmarkNode, event?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    onClose(); // immediate — no animation needed when navigating away
    onPickBookmark(item, event);
  }, [onClose, onPickBookmark]);

  const noopBuildMenu = useCallback<(target: BookmarkNode | null) => ContextMenuItem[]>(() => [], []);
  const noopSetMenu = useCallback<(menu: { x: number; y: number; items: ContextMenuItem[] }) => void>(() => {}, []);

  useKeyboardNav({
    enabled: true,
    navItems,
    focusedTileId,
    setFocusedTileId,
    canvasEl: bodyEl,
    onPickFolder: handleArrowPickFolder,
    onPickBookmark: handleArrowPickBookmark,
    buildContextMenuItems: buildContextMenuItems ?? noopBuildMenu,
    setContextMenu: setContextMenu ?? noopSetMenu,
  });

  const selectionForHook = useMemo(
    () => ({ ids: (selectedIds ?? new Set<string>()) as Set<string> }),
    [selectedIds],
  );
  useDeleteShortcut({
    enabled: true,
    selection: selectionForHook,
    focusedTileId,
    navItems,
    onBatchDelete: (ids) => onBatchDelete?.(ids),
    onDeleteFocused: (item) => onDeleteFocused?.(item),
  });

  // Quick-add / edit shortcuts mirrored from App.tsx so the flow stays consistent
  // when navigating inside the overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      switch (e.key.toLowerCase()) {
        case 'a':
          if (!onNewBookmark) return;
          e.preventDefault();
          onNewBookmark(current.id, current.title);
          break;
        case 'f':
          if (!onNewFolder) return;
          e.preventDefault();
          onNewFolder(current.id, current.title);
          break;
        case 'w':
          if (!onNewWorkspace) return;
          e.preventDefault();
          onNewWorkspace();
          break;
        case 'e': {
          if (!onEditId || !selectedIds || selectedIds.size !== 1) return;
          e.preventDefault();
          const id = [...selectedIds][0];
          onEditId(id);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current.id, current.title, onNewBookmark, onNewFolder, onNewWorkspace, onEditId, selectedIds]);

  const handleItemClick = (item: BookmarkNode, event: ReactMouseEvent) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      onTileSelect?.(item, event);
      return;
    }
    onClearSelection?.();
    if (isFolder(item)) {
      setDirection('forward');
      setStack(s => [...s, item]);
    } else {
      onClose(); // immediate — navigating to a bookmark
      onPickBookmark(item, event);
    }
  };
  const handleBreadcrumbClick = (idx: number) => {
    if (idx === stack.length - 1) return;
    setDirection('back');
    setStack(s => s.slice(0, idx + 1));
  };
  const handleBack = () => {
    if (stack.length > 1) {
      setDirection('back');
      setStack(s => s.slice(0, -1));
    }
  };

  return (
    <div
      className="ff-folder-overlay"
      data-overlay-root-id={rootFolderId}
      data-closing={closing || undefined}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (suppressCloseRef.current) { suppressCloseRef.current = false; return; }
        handleClose();
      }}
    >
      <div className="ff-folder-overlay__card" onClick={(e) => e.stopPropagation()}>
        <div className="ff-folder-overlay__header">
          <button
            className="ff-iconbtn ff-iconbtn--icon"
            onClick={handleBack}
            disabled={stack.length <= 1}
            aria-label="Back to parent folder"
            style={{ opacity: stack.length <= 1 ? 0.35 : 1, pointerEvents: stack.length <= 1 ? 'none' : 'auto' }}
          >
            <Ico name="chevronLeft" size={16} />
          </button>
          <div className="ff-section__icon-folder" style={{ width: 36, height: 36, borderRadius: 10 }}>
            <Ico name="folder" size={16} />
          </div>
          <nav className="ff-folder-overlay__crumbs" aria-label="Folder path">
            {stack.map((f, i) => (
              <span key={f.id} className="ff-crumb-segment">
                {i > 0 && <Ico name="chevronRight" size={11} className="ff-crumb__sep" />}
                <button
                  className="ff-folder-overlay__crumb"
                  data-here={i === stack.length - 1}
                  data-overlay-crumb-id={i < stack.length - 1 ? f.id : undefined}
                  onClick={() => handleBreadcrumbClick(i)}
                >
                  {f.title}
                </button>
              </span>
            ))}
          </nav>
          <span className="ff-folder-overlay__meta">{current.children?.length ?? 0} items</span>
          {onNewBookmark && (
            <button
              className="ff-iconbtn ff-iconbtn--icon"
              onClick={() => onNewBookmark(current.id, current.title)}
              aria-label="Add bookmark to this folder"
              title="Add bookmark"
            >
              <Ico name="plus" size={16} />
            </button>
          )}
          {onNewFolder && (
            <button
              className="ff-iconbtn ff-iconbtn--icon"
              onClick={() => onNewFolder(current.id, current.title)}
              aria-label="Add folder inside"
              title="Add folder"
            >
              <Ico name="folderPlus" size={16} />
            </button>
          )}
          <button className="ff-iconbtn ff-iconbtn--icon" onClick={handleClose} aria-label="Close overlay">
            <Ico name="close" size={16} />
          </button>
        </div>
        <div
          className="ff-folder-overlay__body"
          ref={(el) => { setBodyEl(el); bodyRef?.(el); }}
          key={current.id}
          data-dir={direction}
          data-scope-folder-id={current.id}
        >
          <div className="ff-grid">
            {(current.children ?? []).map(item => (
              <TileFor
                key={item.id}
                item={item}
                shape={shape}
                scopeFolderId={current.id}
                selectedIds={selectedIds}
                selectionScopeFolderId={selectionScopeFolderId}
                focusedTileId={focusedTileId}
                onPickFolder={handleItemClick}
                onPickItem={handleItemClick}
                onContextMenu={onContextMenu}
              />
            ))}
          </div>
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
        </div>
      </div>
    </div>
  );
}
