import { useEffect, useRef, useState } from 'react';
import type { BookmarkNode } from '../../shared/messages';
import { createBookmark, updateBookmark } from '../lib/messaging';
import { Ico } from './Ico';

export type FolderNameDialogTarget =
  | { mode: 'create'; parentId: string; parentTitle?: string }
  | { mode: 'rename'; id: string; title: string };

interface FolderNameDialogProps {
  target: FolderNameDialogTarget;
  onClose: () => void;
  onSaved: (folder: BookmarkNode) => void;
}

export function FolderNameDialog({ target, onClose, onSaved }: FolderNameDialogProps) {
  const initial = target.mode === 'rename' ? target.title : '';
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const name = value.trim();
    if (!name) {
      setError('Enter a folder name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const folder = target.mode === 'rename'
        ? await updateBookmark(target.id, { title: name })
        : await createBookmark(target.parentId, name);
      onSaved(folder);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save folder.');
      setSaving(false);
    }
  };

  const isRename = target.mode === 'rename';
  const eyebrow = isRename ? 'Rename folder' : 'New folder';
  const title = isRename
    ? target.title
    : target.parentTitle ? `In ${target.parentTitle}` : 'Untitled folder';
  const submitLabel = saving ? 'Saving…' : (isRename ? 'Rename' : 'Create folder');

  return (
    <div className="ff-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        className="ff-dialog"
        style={{ width: 'min(480px, 100%)' }}
        onSubmit={handleSubmit}
      >
        <div className="ff-dialog__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
            <div className="ff-section__icon-folder" style={{ width: 36, height: 36 }}>
              <Ico name={isRename ? 'pencil' : 'folderPlus'} size={16} />
            </div>
            <div>
              <div className="ff-dialog__eyebrow">{eyebrow}</div>
              <div className="ff-dialog__title">{title}</div>
            </div>
          </div>
          <button type="button" className="ff-iconbtn ff-iconbtn--icon" aria-label="Close" onClick={onClose}>
            <Ico name="close" size={16} />
          </button>
        </div>
        <div className="ff-dialog__body" style={{ gridTemplateColumns: '1fr', gap: 12 }}>
          <div className="ff-field">
            <label className="ff-field__label">Name</label>
            <input
              ref={inputRef}
              className="ff-input"
              type="text"
              spellCheck={false}
              value={value}
              onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
              placeholder="Folder name"
            />
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: 12 }} role="alert">{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="ff-btn" disabled={saving}>
              <Ico name="check" size={14} /> {submitLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
