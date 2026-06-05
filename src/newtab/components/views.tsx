import type { MouseEvent } from 'react';
import type { BookmarkNode, TileShape } from '@/shared/messages';
import { BookmarkTile, FolderTile, SectionHeader, TileFor } from './Tile';
import { Ico } from './Ico';

interface BaseViewProps {
  shape: TileShape;
  onPickFolder: (folder: BookmarkNode, event: MouseEvent) => void;
  onPickItem: (item: BookmarkNode, event: MouseEvent) => void;
  onContextMenu?: (target: BookmarkNode, event: MouseEvent) => void;
  selectedIds?: ReadonlySet<string>;
  selectionScopeFolderId?: string;
  focusedTileId?: string | null;
}

interface TreeViewProps extends BaseViewProps {
  tree: BookmarkNode[];
  scopeFolderId: string;
  onSectionMenu?: (folder: BookmarkNode, event: MouseEvent) => void;
}

interface TilesViewProps extends Omit<TreeViewProps, 'onSectionMenu'> {
  rootBookmarks?: BookmarkNode[];
  onEmptyAdd?: () => void;
}

interface SectionsViewProps extends TreeViewProps {
  dragEnabled?: boolean;
  rootBookmarks?: BookmarkNode[];
  onEmptyAdd?: () => void;
}

function EmptyRoot({ scopeFolderId, onAdd }: { scopeFolderId: string; onAdd?: () => void }) {
  return (
    <div className="ff-page-view" data-scope-folder-id={scopeFolderId}>
      <div className="ff-empty">
        <div className="ff-empty__icon"><Ico name="bookmark" size={28} /></div>
        <h3>No bookmarks yet</h3>
        <p>Add your first bookmark to get started.</p>
        {onAdd && (
          <button type="button" className="ff-btn" onClick={onAdd}>
            <Ico name="plus" size={14} /> Add bookmark
          </button>
        )}
      </div>
    </div>
  );
}

function isSelectedIn(scope: string, containerScope: string, ids: ReadonlySet<string> | undefined, itemId: string): boolean {
  if (!ids || ids.size === 0) return false;
  if (scope !== containerScope) return false;
  return ids.has(itemId);
}

export function TilesView({ tree, rootBookmarks, shape, scopeFolderId, onPickFolder, onPickItem, onContextMenu, selectedIds, selectionScopeFolderId, focusedTileId, onEmptyAdd }: TilesViewProps) {
  if (tree.length === 0 && (rootBookmarks ?? []).length === 0) {
    return <EmptyRoot scopeFolderId={scopeFolderId} onAdd={onEmptyAdd} />;
  }
  return (
    <div className="ff-grid" data-scope-folder-id={scopeFolderId}>
      {tree.map(folder => (
        <FolderTile
          key={folder.id}
          folder={folder}
          shape={shape}
          selected={isSelectedIn(scopeFolderId, selectionScopeFolderId ?? '', selectedIds, folder.id)}
          focused={focusedTileId === folder.id}
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
          focused={focusedTileId === item.id}
          onClick={onPickItem}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

export function SectionsView({ tree, rootBookmarks, shape, scopeFolderId, dragEnabled, onPickFolder, onPickItem, onSectionMenu, onContextMenu, selectedIds, selectionScopeFolderId, focusedTileId, onEmptyAdd }: SectionsViewProps) {
  if (tree.length === 0 && (rootBookmarks ?? []).length === 0) {
    return <EmptyRoot scopeFolderId={scopeFolderId} onAdd={onEmptyAdd} />;
  }
  return (
    <div className="ff-sections" data-scope-folder-id={scopeFolderId}>
      {(rootBookmarks ?? []).length > 0 && (
        <div className="ff-grid" data-scope-folder-id={scopeFolderId}>
          {(rootBookmarks ?? []).map(item => (
            <TileFor
              key={item.id}
              item={item}
              shape={shape}
              scopeFolderId={scopeFolderId}
              selectedIds={selectedIds}
              selectionScopeFolderId={selectionScopeFolderId}
              focusedTileId={focusedTileId}
              onPickFolder={onPickFolder}
              onPickItem={onPickItem}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
      {tree.map(folder => (
        <section key={folder.id} data-scope-folder-id={folder.id}>
          <SectionHeader folder={folder} onMenu={onSectionMenu} rootFolderId={scopeFolderId} dragEnabled={dragEnabled} />
          <div className="ff-section__rule" aria-hidden="true" />
          <div className="ff-grid">
            {(folder.children ?? []).length === 0 && (
              <p className="ff-section__empty-hint" aria-hidden="true">Empty folder</p>
            )}
            {(folder.children ?? []).map(item => (
              <TileFor
                key={item.id}
                item={item}
                shape={shape}
                scopeFolderId={folder.id}
                selectedIds={selectedIds}
                selectionScopeFolderId={selectionScopeFolderId}
                focusedTileId={focusedTileId}
                onPickFolder={onPickFolder}
                onPickItem={onPickItem}
                onContextMenu={onContextMenu}
              />
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

export function FolderPageView({ folder, shape, onPickFolder, onPickItem, onContextMenu, selectedIds, selectionScopeFolderId, focusedTileId }: FolderPageViewProps) {
  const children = folder.children ?? [];
  return (
    <div className="ff-page-view" data-scope-folder-id={folder.id}>
      <div className="ff-grid">
        {children.map(item => (
          <TileFor
            key={item.id}
            item={item}
            shape={shape}
            scopeFolderId={folder.id}
            selectedIds={selectedIds}
            selectionScopeFolderId={selectionScopeFolderId}
            focusedTileId={focusedTileId}
            onPickFolder={onPickFolder}
            onPickItem={onPickItem}
            onContextMenu={onContextMenu}
          />
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
