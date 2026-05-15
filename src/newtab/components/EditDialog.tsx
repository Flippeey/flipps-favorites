import { useEffect, useState } from 'react';
import type { BookmarkNode, TileShape } from '../../shared/messages';
import { createBookmark, updateBookmark } from '../lib/messaging';
import { Favicon } from './Favicon';
import { Ico } from './Ico';

export interface EditTarget {
  id?: string;
  parentId?: string;
  title: string;
  url: string;
}

interface EditDialogProps {
  target: EditTarget;
  shape: TileShape;
  onClose: () => void;
  onSaved: (bookmark: BookmarkNode) => void;
}

export function EditDialog({ target, shape, onClose, onSaved }: EditDialogProps) {
  const [title, setTitle] = useState(target.title);
  const [url, setUrl] = useState(target.url);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let bookmark: BookmarkNode;
      if (target.id) {
        bookmark = await updateBookmark(target.id, { title, url });
      } else {
        bookmark = await createBookmark(target.parentId ?? '1', title, url);
      }
      onSaved(bookmark);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save bookmark.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ff-modal-scrim" onClick={onClose}>
      <div className="ff-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ff-dialog__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <div className="ff-section__icon-folder" style={{ width: 36, height: 36 }}>
              <Ico name="pencil" size={16} />
            </div>
            <div>
              <div className="ff-dialog__eyebrow">{target.id ? 'Edit bookmark' : 'New bookmark'}</div>
              <div className="ff-dialog__title">{title || 'Untitled'}</div>
            </div>
          </div>
          <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Close" onClick={onClose}>
            <Ico name="close" size={16} />
          </button>
        </div>
        <div className="ff-dialog__body">
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ff-field">
              <label className="ff-field__label">Name</label>
              <input className="ff-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="ff-field">
              <label className="ff-field__label">URL</label>
              <input className="ff-input" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="ff-iconpreview" aria-label="Icon preview">
              <div style={{ width: '70%', height: '70%' }}>
                <Favicon url={url} title={title} shape={shape} />
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center' }}>
              Icon is resolved automatically from the URL.
            </div>
            {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
            <button className="ff-btn" disabled={saving} onClick={handleSave}>
              <Ico name="check" size={14} /> {saving ? 'Saving…' : 'Save bookmark'}
            </button>
          </aside>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
            <div>
              <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
                About this bookmark
              </h4>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.55 }}>
                Bookmark icons are fetched from the live page. You can override the icon any time
                from the right-click menu (Replace icon… / Reset icon).
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
