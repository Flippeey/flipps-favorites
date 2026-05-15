import type { MouseEvent } from 'react';
import type { BookmarkNode, TileShape } from '../../shared/messages';
import { BookmarkTile, FolderTile, isFolder, SectionHeader } from './Tile';
import { Ico } from './Ico';

interface BaseViewProps {
  shape: TileShape;
  onPickFolder: (folder: BookmarkNode, event: MouseEvent) => void;
  onPickItem: (item: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (target: BookmarkNode, event: MouseEvent) => void;
}

interface TreeViewProps extends BaseViewProps {
  tree: BookmarkNode[];
  onAdd?: (folder: BookmarkNode) => void;
}

export function TilesView({ tree, shape, onPickFolder, onPickItem, onContextMenu }: TreeViewProps) {
  const looseBookmarks = tree.flatMap(f => (f.children ?? []).filter(c => !isFolder(c)).slice(0, 2));
  return (
    <div className="ff-grid">
      {tree.map(folder => (
        <FolderTile
          key={folder.id}
          folder={folder}
          shape={shape}
          onClick={onPickFolder}
          onContextMenu={onContextMenu}
        />
      ))}
      {looseBookmarks.map(item => (
        <BookmarkTile
          key={`loose-${item.id}`}
          item={item}
          shape={shape}
          onClick={onPickItem}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export function SectionsView({ tree, shape, onPickFolder, onPickItem, onAdd, onContextMenu }: TreeViewProps) {
  return (
    <div className="ff-sections">
      {tree.map(folder => (
        <section key={folder.id}>
          <SectionHeader folder={folder} onAdd={onAdd} />
          <div className="ff-section__rule" aria-hidden="true" />
          <div className="ff-grid">
            {(folder.children ?? []).map(item => (
              isFolder(item)
                ? <FolderTile key={item.id} folder={item} shape={shape} onClick={onPickFolder} onContextMenu={onContextMenu} />
                : <BookmarkTile key={item.id} item={item} shape={shape} onClick={onPickItem} onContextMenu={onContextMenu} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface FolderPageViewProps extends BaseViewProps {
  folder: BookmarkNode;
}

export function FolderPageView({ folder, shape, onPickFolder, onPickItem, onContextMenu }: FolderPageViewProps) {
  const children = folder.children ?? [];
  return (
    <div className="ff-page-view">
      <div className="ff-grid">
        {children.map(item => (
          isFolder(item)
            ? <FolderTile key={item.id} folder={item} shape={shape} onClick={onPickFolder} onContextMenu={onContextMenu} />
            : <BookmarkTile key={item.id} item={item} shape={shape} onClick={onPickItem} onContextMenu={onContextMenu} />
        ))}
      </div>
      {children.length === 0 && (
        <div className="ff-empty">
          <div className="ff-empty__icon"><Ico name="folder" size={28} /></div>
          <h3>This folder is empty</h3>
          <p>Drag in a bookmark, or add a new one to get started.</p>
        </div>
      )}
    </div>
  );
}
