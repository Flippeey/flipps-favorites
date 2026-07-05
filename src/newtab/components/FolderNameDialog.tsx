import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import { createBookmark, updateBookmark } from '../lib/messaging';
import { findFolder, isFolder } from '../lib/tree';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';
import { FolderPicker } from './FolderPicker';

export type FolderNameDialogTarget =
  | { mode: 'create'; parentId: string; parentTitle?: string; moveIds?: string[] }
  | { mode: 'rename'; id: string; title: string };

interface FolderNameDialogProps {
  tree: BookmarkNode[];
  target: FolderNameDialogTarget;
  siblingNames?: string[];
  onClose: () => void;
  onSaved: (folder: BookmarkNode) => void;
}

export function FolderNameDialog({ tree, target, siblingNames, onClose, onSaved }: FolderNameDialogProps) {
  const initial = target.mode === 'rename' ? target.title : '';
  const [value, setValue] = useState(initial);
  const [parentIdOverride, setParentIdOverride] = useState(
    target.mode === 'create' ? target.parentId : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // If the user picks a different destination than the default, the sibling
  // names passed down from App (computed against the default parent) go
  // stale — recompute locally against the chosen parent in that case.
  const effectiveSiblingNames = useMemo<string[] | undefined>(() => {
    if (target.mode !== 'create' || parentIdOverride === target.parentId) return siblingNames;
    const parent = findFolder(tree, parentIdOverride);
    return (parent?.children ?? []).filter(isFolder).map(f => f.title);
  }, [target, parentIdOverride, siblingNames, tree]);

  // Non-blocking duplicate-name hint — the browser allows sibling folders with
  // the same name, so we warn but never block submit.
  const trimmedLower = value.trim().toLowerCase();
  const duplicateWarning = trimmedLower && (effectiveSiblingNames ?? []).some(n => n.toLowerCase() === trimmedLower)
    ? 'A folder with this name already exists here.'
    : null;

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
        : await createBookmark(parentIdOverride, name);
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
      {target.mode === 'create' && (
        <div className="ff-field">
          <label className="ff-field__label">Parent folder</label>
          <FolderPicker tree={tree} selectedId={parentIdOverride} onSelect={setParentIdOverride} />
        </div>
      )}
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      {!error && duplicateWarning && <div className="ff-status" data-kind="info" role="status">{duplicateWarning}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="ff-btn" disabled={saving}>
          <Ico name="check" size={14} /> {submitLabel}
        </button>
      </div>
    </ModalDialog>
  );
}
