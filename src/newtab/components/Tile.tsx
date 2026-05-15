import type { MouseEvent } from 'react';
import type { BookmarkNode, TileShape } from '../../shared/messages';
import { Favicon } from './Favicon';
import { Ico } from './Ico';

export function isFolder(node: BookmarkNode): boolean {
  return Array.isArray(node.children);
}

interface BookmarkTileProps {
  item: BookmarkNode;
  shape: TileShape;
  selected?: boolean;
  onClick?: (item: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (item: BookmarkNode, event: MouseEvent) => void;
}

export function BookmarkTile({ item, shape, selected = false, onClick, onContextMenu }: BookmarkTileProps) {
  return (
    <button
      className="ff-tile"
      data-selected={selected}
      data-item-id={item.id}
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
  onClick?: (folder: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (folder: BookmarkNode, event: MouseEvent) => void;
}

export function FolderTile({ folder, shape, onClick, onContextMenu }: FolderTileProps) {
  const items: (BookmarkNode | null)[] = (folder.children ?? []).slice(0, 4);
  while (items.length < 4) items.push(null);
  return (
    <button
      className="ff-tile"
      data-item-id={folder.id}
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

interface SectionHeaderProps {
  folder: BookmarkNode;
  onAdd?: (folder: BookmarkNode) => void;
}

export function SectionHeader({ folder, onAdd }: SectionHeaderProps) {
  return (
    <header className="ff-section__header">
      <div className="ff-section__icon-folder">
        <Ico name="folder" size={16} />
      </div>
      <h3 className="ff-section__title">{folder.title}</h3>
      <span className="ff-section__count">{folder.children?.length ?? 0}</span>
      <div className="ff-section__spacer" />
      <button className="ff-section__action" aria-label="More">
        <Ico name="more" size={16} />
      </button>
      <button className="ff-section__action" aria-label="Add to section" onClick={() => onAdd?.(folder)}>
        <Ico name="plus" size={16} />
      </button>
    </header>
  );
}
