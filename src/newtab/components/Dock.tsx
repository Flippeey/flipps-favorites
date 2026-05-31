import type { BookmarkNode, TileShape } from '@/shared/messages';
import { isFolder } from '../lib/tree';
import { Favicon } from './Favicon';

interface DockProps {
  items: BookmarkNode[];
  mode: 'always' | 'hover' | 'hidden';
  shape: TileShape;
  dockFolderId: string;
  onItemClick?: (item: BookmarkNode) => void;
  onFolderClick?: (folder: BookmarkNode) => void;
  surfaceRef?: (el: HTMLDivElement | null) => void;
}

function DockFolderPreview({ folder }: { folder: BookmarkNode }) {
  const previews: (BookmarkNode | null)[] = (folder.children ?? []).slice(0, 4);
  while (previews.length < 4) previews.push(null);
  return (
    <div className="ff-dock__folder">
      {previews.map((child, i) => (
        <div key={i} className="ff-dock__folder-cell">
          {child && !isFolder(child) && (
            <Favicon url={child.url} title={child.title} shape="rounded" />
          )}
          {child && isFolder(child) && (
            <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="currentColor"
                 strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            </svg>
          )}
        </div>
      ))}
    </div>
  );
}

export function Dock({ items, mode, shape, dockFolderId, onItemClick, onFolderClick, surfaceRef }: DockProps) {
  if (mode === 'hidden') return null;
  return (
    <div className="ff-dock-wrap" data-mode={mode}>
      <div className="ff-dock" data-scope-folder-id={dockFolderId} ref={surfaceRef}>
        {items.map(it => {
          const folder = isFolder(it);
          return (
            <button
              key={it.id}
              className="ff-dock__item"
              data-item-id={it.id}
              data-item-kind={folder ? 'folder' : 'bookmark'}
              aria-label={it.title}
              title={it.title}
              onClick={() => {
                if (folder) onFolderClick?.(it);
                else onItemClick?.(it);
              }}
            >
              <div style={{ width: 52, height: 52 }}>
                {folder ? (
                  <DockFolderPreview folder={it} />
                ) : (
                  <Favicon url={it.url} title={it.title} shape={shape} />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
