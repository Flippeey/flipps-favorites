import type { BookmarkNode, TileShape } from '../../shared/messages';
import { Favicon } from './Favicon';

interface DockProps {
  items: BookmarkNode[];
  mode: 'always' | 'hover' | 'hidden';
  shape: TileShape;
  dockFolderId: string;
  onItemClick?: (item: BookmarkNode) => void;
  surfaceRef?: (el: HTMLDivElement | null) => void;
}

export function Dock({ items, mode, shape, dockFolderId, onItemClick, surfaceRef }: DockProps) {
  if (mode === 'hidden') return null;
  return (
    <div className="ff-dock-wrap" data-mode={mode}>
      <div className="ff-dock" data-scope-folder-id={dockFolderId} ref={surfaceRef}>
        {items.map(it => (
          <button
            key={it.id}
            className="ff-dock__item"
            data-item-id={it.id}
            data-item-kind="bookmark"
            aria-label={it.title}
            title={it.title}
            onClick={() => onItemClick?.(it)}
          >
            <div style={{ width: 44, height: 44 }}>
              <Favicon url={it.url} title={it.title} shape={shape} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
