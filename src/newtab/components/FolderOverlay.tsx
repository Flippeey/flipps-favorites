import type { MouseEvent as ReactMouseEvent } from 'react';
import { useEffect, useState } from 'react';
import type { BookmarkNode, TileShape } from '../../shared/messages';
import { BookmarkTile, FolderTile, isFolder } from './Tile';
import { Ico } from './Ico';

interface FolderOverlayProps {
  folder: BookmarkNode;
  shape: TileShape;
  onClose: () => void;
  onPickBookmark: (item: BookmarkNode, event?: { metaKey?: boolean; ctrlKey?: boolean }) => void;
  onContextMenu?: (target: BookmarkNode, event: ReactMouseEvent) => void;
  onNewBookmark?: (parentId: string, parentTitle?: string) => void;
  onNewFolder?: (parentId: string, parentTitle?: string) => void;
}

export function FolderOverlay({ folder, shape, onClose, onPickBookmark, onContextMenu, onNewBookmark, onNewFolder }: FolderOverlayProps) {
  const [stack, setStack] = useState<BookmarkNode[]>([folder]);
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  const current = stack[stack.length - 1];

  useEffect(() => {
    setStack([folder]);
    setDirection('forward');
  }, [folder.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'Backspace' || (e.key === 'ArrowLeft' && e.metaKey)) {
        if (stack.length > 1) {
          setDirection('back');
          setStack(s => s.slice(0, -1));
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stack.length]);

  const handleItemClick = (item: BookmarkNode, event: ReactMouseEvent) => {
    if (isFolder(item)) {
      setDirection('forward');
      setStack(s => [...s, item]);
    } else {
      onClose();
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
    <div className="ff-folder-overlay" onClick={onClose}>
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
              <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <Ico name="chevronRight" size={11} className="ff-crumb__sep" />}
                <button
                  className="ff-folder-overlay__crumb"
                  data-here={i === stack.length - 1}
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
          <button className="ff-iconbtn ff-iconbtn--icon" onClick={onClose} aria-label="Close overlay">
            <Ico name="close" size={16} />
          </button>
        </div>
        <div
          className="ff-folder-overlay__body"
          key={current.id}
          data-dir={direction}
          data-scope-folder-id={current.id}
        >
          <div className="ff-grid">
            {(current.children ?? []).map(item => (
              isFolder(item)
                ? <FolderTile key={item.id} folder={item} shape={shape} onClick={handleItemClick} onContextMenu={onContextMenu} />
                : <BookmarkTile key={item.id} item={item} shape={shape} onClick={handleItemClick} onContextMenu={onContextMenu} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
