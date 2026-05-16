import type { MouseEvent } from 'react';
import type { BookmarkNode, TileShape } from '../../shared/messages';
import { BookmarkTile, FolderTile, isFolder, SectionHeader } from './Tile';
import { Ico } from './Ico';

interface BaseViewProps {
  shape: TileShape;
  onPickFolder: (folder: BookmarkNode, event: MouseEvent) => void;
  onPickItem: (item: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (target: BookmarkNode, event: MouseEvent) => void;
  selectedIds?: ReadonlySet<string>;
  selectionScopeFolderId?: string;
}

interface TreeViewProps extends BaseViewProps {
  tree: BookmarkNode[];
  scopeFolderId: string;
  onAdd?: (folder: BookmarkNode) => void;
}

interface TilesViewProps extends TreeViewProps {
  rootBookmarks?: BookmarkNode[];
}

function isSelectedIn(scope: string, containerScope: string, ids: ReadonlySet<string> | undefined, itemId: string): boolean {
  if (!ids || ids.size === 0) return false;
  if (scope !== containerScope) return false;
  return ids.has(itemId);
}

export function TilesView({ tree, rootBookmarks, shape, scopeFolderId, onPickFolder, onPickItem, onContextMenu, selectedIds, selectionScopeFolderId }: TilesViewProps) {
  return (
    <div className="ff-grid" data-scope-folder-id={scopeFolderId}>
      {tree.map(folder => (
        <FolderTile
          key={folder.id}
          folder={folder}
          shape={shape}
          selected={isSelectedIn(scopeFolderId, selectionScopeFolderId ?? '', selectedIds, folder.id)}
          onClick={onPickFolder}
          onContextMenu={onContextMenu}
        />
      ))}
      {(rootBookmarks ?? []).map(item => (
        <BookmarkTile
          key={item.id}
          item={item}
          shape={shape}
          selected={isSelectedIn(scopeFolderId, selectionScopeFolderId ?? '', selectedIds, item.id)}
          onClick={onPickItem}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export function SectionsView({ tree, shape, scopeFolderId, onPickFolder, onPickItem, onAdd, onContextMenu, selectedIds, selectionScopeFolderId }: TreeViewProps) {
  return (
    <div className="ff-sections" data-scope-folder-id={scopeFolderId}>
      {tree.map(folder => (
        <section key={folder.id} data-scope-folder-id={folder.id}>
          <SectionHeader folder={folder} onAdd={onAdd} />
          <div className="ff-section__rule" aria-hidden="true" />
          <div className="ff-grid">
            {(folder.children ?? []).map(item => (
              isFolder(item)
                ? <FolderTile key={item.id} folder={item} shape={shape} selected={isSelectedIn(folder.id, selectionScopeFolderId ?? '', selectedIds, item.id)} onClick={onPickFolder} onContextMenu={onContextMenu} />
                : <BookmarkTile key={item.id} item={item} shape={shape} selected={isSelectedIn(folder.id, selectionScopeFolderId ?? '', selectedIds, item.id)} onClick={onPickItem} onContextMenu={onContextMenu} />
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

export function FolderPageView({ folder, shape, onPickFolder, onPickItem, onContextMenu, selectedIds, selectionScopeFolderId }: FolderPageViewProps) {
  const children = folder.children ?? [];
  return (
    <div className="ff-page-view" data-scope-folder-id={folder.id}>
      <div className="ff-grid">
        {children.map(item => (
          isFolder(item)
            ? <FolderTile key={item.id} folder={item} shape={shape} selected={isSelectedIn(folder.id, selectionScopeFolderId ?? '', selectedIds, item.id)} onClick={onPickFolder} onContextMenu={onContextMenu} />
            : <BookmarkTile key={item.id} item={item} shape={shape} selected={isSelectedIn(folder.id, selectionScopeFolderId ?? '', selectedIds, item.id)} onClick={onPickItem} onContextMenu={onContextMenu} />
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
