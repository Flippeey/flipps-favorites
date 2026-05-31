import type { MouseEvent } from 'react';
import type { BookmarkNode, TileShape } from '@/shared/messages';
import { isFolder } from '../lib/tree';
import { Favicon } from './Favicon';
import { Ico } from './Ico';

interface BookmarkTileProps {
  item: BookmarkNode;
  shape: TileShape;
  selected?: boolean;
  focused?: boolean;
  onClick?: (item: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (item: BookmarkNode, event: MouseEvent) => void;
}

export function BookmarkTile({ item, shape, selected = false, focused = false, onClick, onContextMenu }: BookmarkTileProps) {
  return (
    <button
      className="ff-tile"
      data-selected={selected}
      data-focused={focused || undefined}
      data-item-id={item.id}
      data-item-kind="bookmark"
      onClick={(e) => onClick?.(item, e)}
      onContextMenu={(e) => onContextMenu?.(item, e)}
      title={item.title}
    >
      <div className="ff-tile__icon">
        <Favicon url={item.url} title={item.title} shape={shape} />
      </div>
      <div className="ff-tile__label">{item.title}</div>
    </button>
  );
}

interface FolderTileProps {
  folder: BookmarkNode;
  shape: TileShape;
  selected?: boolean;
  focused?: boolean;
  onClick?: (folder: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (folder: BookmarkNode, event: MouseEvent) => void;
}

export function FolderTile({ folder, shape, selected = false, focused = false, onClick, onContextMenu }: FolderTileProps) {
  const items: (BookmarkNode | null)[] = (folder.children ?? []).slice(0, 4);
  while (items.length < 4) items.push(null);
  return (
    <button
      className="ff-tile"
      data-selected={selected}
      data-focused={focused || undefined}
      data-item-id={folder.id}
      data-item-kind="folder"
      onClick={(e) => onClick?.(folder, e)}
      onContextMenu={(e) => onContextMenu?.(folder, e)}
      title={folder.title}
    >
      <div className="ff-tile__icon">
        <div className="ff-folder-tile">
          {items.map((it, i) => (
            <div key={i} className="ff-folder-tile__mini">
              {it == null && <div className="ff-folder-tile__empty" />}
              {it && !isFolder(it) && <Favicon url={it.url} title={it.title} shape="rounded" />}
              {it && isFolder(it) && (
                <div className="ff-folder-tile__sub">
                  <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="currentColor"
                       strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                </div>
              )}
            </div>
          ))}
          <span className="ff-folder-tile__count">{folder.children?.length ?? 0}</span>
        </div>
      </div>
      <div className="ff-tile__label">{folder.title}</div>
    </button>
  );
}

interface TileForProps {
  item: BookmarkNode;
  shape: TileShape;
  scopeFolderId: string;
  selectedIds?: ReadonlySet<string>;
  selectionScopeFolderId?: string;
  focusedTileId?: string | null;
  onPickFolder?: (folder: BookmarkNode, event: MouseEvent) => void;
  onPickItem?: (item: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (item: BookmarkNode, event: MouseEvent) => void;
}

export function TileFor({
  item,
  shape,
  scopeFolderId,
  selectedIds,
  selectionScopeFolderId,
  focusedTileId,
  onPickFolder,
  onPickItem,
  onContextMenu,
}: TileForProps) {
  const selected = selectedIds && selectionScopeFolderId === scopeFolderId && selectedIds.has(item.id);
  const focused = focusedTileId === item.id;
  return isFolder(item) ? (
    <FolderTile folder={item} shape={shape} selected={selected} focused={focused} onClick={onPickFolder} onContextMenu={onContextMenu} />
  ) : (
    <BookmarkTile item={item} shape={shape} selected={selected} focused={focused} onClick={onPickItem} onContextMenu={onContextMenu} />
  );
}

interface SectionHeaderProps {
  folder: BookmarkNode;
  rootFolderId?: string;
  dragEnabled?: boolean;
  onMenu?: (folder: BookmarkNode, event: MouseEvent) => void;
}

export function SectionHeader({ folder, rootFolderId, dragEnabled, onMenu }: SectionHeaderProps) {
  const count = folder.children?.length ?? 0;
  const dragAttrs = dragEnabled && rootFolderId ? {
    'data-item-id': folder.id,
    'data-item-kind': 'section' as const,
    'data-scope-folder-id': rootFolderId,
  } : {};
  return (
    <header className="ff-section__header" {...dragAttrs}>
      <div className="ff-section__icon-folder">
        <Ico name="folder" size={16} />
      </div>
      <h3 className="ff-section__title">{folder.title}</h3>
      <span className="ff-section__count" aria-label={`${count} ${count === 1 ? 'item' : 'items'}`}>
        {count}
      </span>
      <button
        type="button"
        className="ff-section__menu"
        aria-label={`Open menu for ${folder.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onMenu?.(folder, e);
        }}
      >
        <Ico name="moreVertical" size={16} />
      </button>
    </header>
  );
}
