import { useEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import {
  createBookmark,
  getFolderIcon,
  removeFolderIcon,
  searchIcons,
  setFolderIcon,
  setFolderIconFromUrl,
  updateBookmark,
} from '../lib/messaging';
import { invalidateFolderIconCache } from '../lib/folder-icon-cache';
import { findFolder, isFolder } from '../lib/tree';
import { useIconPicker } from '../state/useIconPicker';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';
import { FolderPicker } from './FolderPicker';
import { IconPickerPanel } from './IconPickerPanel';

function defaultFolderQuery(title: string): string {
  const seed = title.trim() || 'folder';
  return `${seed} logo`.trim();
}

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

  // Icon management only applies to an existing folder (rename mode has a real
  // id to key the folder-icons IDB store by; a not-yet-created folder has none).
  const canManageIcon = target.mode === 'rename';
  const folderId = target.mode === 'rename' ? target.id : undefined;

  const [iconStatus, setIconStatus] = useState<{ message: string; kind: 'info' | 'success' | 'error' } | null>(null);

  const picker = useIconPicker({
    enabled: canManageIcon,
    identityKey: folderId,
    initialQuery: defaultFolderQuery(initial),
    // Folder search has no dedicated status box, unlike the bookmark dialog's
    // shared one — a "no matches" / "search failed" note here would have
    // nowhere to appear other than iconStatus, which is reserved for apply
    // outcomes.
    notifySearchResult: false,
    onStatus: setIconStatus,
    loadInitial: () => getFolderIcon(folderId!),
    search: (q) => searchIcons(q),
    applyCandidate: async (candidate) => {
      const record = await setFolderIconFromUrl({
        folderId: folderId!,
        imageUrl: candidate.imageUrl,
        fallbackImageUrl: candidate.previewUrl !== candidate.imageUrl ? candidate.previewUrl : undefined,
      });
      invalidateFolderIconCache(folderId!);
      return record;
    },
    applyUpload: async (dataUrl, file) => {
      const record = await setFolderIcon({ folderId: folderId!, dataUrl, fileName: file.name, mimeType: 'image/png' });
      invalidateFolderIconCache(folderId!);
      return record;
    },
    remove: {
      run: async () => {
        await removeFolderIcon(folderId!, { recordDeletion: true });
        invalidateFolderIconCache(folderId!);
        return null;
      },
      successMessage: 'Icon removed.',
      errorMessage: 'Could not remove icon.',
    },
  });

  const previewSrc = picker.preview?.dataUrl ?? null;
  const handlePickCandidate = picker.pickCandidate;
  const handlePickCandidateAndClose = picker.pickCandidateAndClose;

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

  const isEdit = target.mode === 'rename';
  const eyebrow = isEdit ? 'Edit folder' : 'New folder';
  const title = isEdit
    ? target.title
    : target.parentTitle ? `In ${target.parentTitle}` : 'Untitled folder';
  const submitLabel = saving ? 'Saving…' : (isEdit ? 'Save folder' : 'Create folder');

  const nameField = (
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
  );

  const statusRows = (
    <>
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      {!error && duplicateWarning && <div className="ff-status" data-kind="info" role="status">{duplicateWarning}</div>}
    </>
  );

  const actions = (
    <div className="ff-dialog__actions">
      <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
      <button type="submit" className="ff-btn" disabled={saving}>
        <Ico name="check" size={14} /> {submitLabel}
      </button>
    </div>
  );

  // Create mode has no icon picker (no folder id to key the record by), so it
  // keeps the narrow single-column form. Edit mode mirrors EditDialog's default
  // two-column body (280px aside + search grid) so both dialogs read the same.
  if (!isEdit) {
    return (
      <ModalDialog
        icon="folderPlus"
        eyebrow={eyebrow}
        title={title}
        onClose={onClose}
        width="min(480px, 100%)"
        bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
        as="form"
        onSubmit={handleSubmit}
      >
        {nameField}
        <div className="ff-field">
          <label className="ff-field__label">Parent folder</label>
          <FolderPicker tree={tree} selectedId={parentIdOverride} onSelect={setParentIdOverride} />
        </div>
        {statusRows}
        {actions}
      </ModalDialog>
    );
  }

  return (
    <ModalDialog
      icon="pencil"
      eyebrow={eyebrow}
      title={title}
      onClose={onClose}
      as="form"
      onSubmit={handleSubmit}
    >
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {nameField}
        <IconPickerPanel
          section="preview"
          previewSrc={previewSrc}
          fallbackLetter={value?.[0] ?? '?'}
          canManage={canManageIcon}
          onRemove={picker.handleRemove}
          onUploadClick={picker.handleUploadClick}
          fileInputRef={picker.fileInputRef}
          onFileChange={picker.handleFileChange}
          hintText="Hover the preview to change or remove the folder icon."
        />
        {iconStatus && (
          <div className="ff-status" data-kind={iconStatus.kind} role="status">
            {iconStatus.message}
          </div>
        )}
        {statusRows}
        {actions}
      </aside>

      <IconPickerPanel
        section="search"
        canManage={canManageIcon}
        query={picker.query}
        onQueryChange={picker.setQuery}
        onSearchSubmit={picker.handleSearchSubmit}
        searching={picker.searching}
        results={picker.results}
        validatedPreviews={picker.validatedPreviews}
        onPreviewLoad={picker.handlePreviewLoad}
        onPickCandidate={handlePickCandidate}
        onPickCandidateAndClose={handlePickCandidateAndClose}
        heading="Search folder icons"
      />
    </ModalDialog>
  );
}
