import type { BookmarkNode, TileShape } from '../../shared/messages';
import { Favicon } from './Favicon';
import { Ico } from './Ico';

interface DockProps {
  items: BookmarkNode[];
  mode: 'always' | 'hover' | 'hidden';
  shape: TileShape;
  onItemClick?: (item: BookmarkNode) => void;
}

export function Dock({ items, mode, shape, onItemClick }: DockProps) {
  if (mode === 'hidden') return null;
  return (
    <div className="ff-dock-wrap" data-mode={mode}>
      <div className="ff-dock">
        {items.map(it => (
          <button
            key={it.id}
            className="ff-dock__item"
            aria-label={it.title}
            title={it.title}
            onClick={() => onItemClick?.(it)}
          >
            <div style={{ width: 44, height: 44 }}>
              <Favicon url={it.url} title={it.title} shape={shape} />
            </div>
          </button>
        ))}
        <div className="ff-dock__divider" aria-hidden="true" />
        <button className="ff-dock__add" aria-label="Add to dock">
          <Ico name="plus" size={18} />
        </button>
      </div>
    </div>
  );
}
