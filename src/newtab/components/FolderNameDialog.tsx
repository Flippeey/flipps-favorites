import { useEffect, useRef, useState } from 'react';
import type { BookmarkNode } from '../../shared/messages';
import { createBookmark, updateBookmark } from '../lib/messaging';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';

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
    <ModalDialog
      icon={isRename ? 'pencil' : 'folderPlus'}
      eyebrow={eyebrow}
      title={title}
      onClose={onClose}
      width="min(480px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
      as="form"
      onSubmit={handleSubmit}
    >
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
    </ModalDialog>
  );
}
