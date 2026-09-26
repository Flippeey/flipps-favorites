import { useState } from 'react';
import type { BookmarkNode } from '@/shared/messages';
import { findFolder } from '../lib/tree';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';
import { FolderPicker } from './FolderPicker';

export interface MoveToFolderTarget {
  ids: string[];
  parentId: string;
}

interface MoveToFolderDialogProps {
  tree: BookmarkNode[];
  target: MoveToFolderTarget;
  // Folder ids that must not be chosen as a destination — the moving folders
  // themselves and their own descendants (dropping a folder into itself or a
  // child would orphan it).
  excludeIds?: Set<string>;
  onClose: () => void;
  onMoveHere: (folder: BookmarkNode) => void;
  onCreateNew: (folder: BookmarkNode) => void;
}

export function MoveToFolderDialog({ tree, target, excludeIds, onClose, onMoveHere, onCreateNew }: MoveToFolderDialogProps) {
  // The current folder is a sensible default for "Create new folder in…", but
  // it must never default to an excluded folder.
  const [selectedId, setSelectedId] = useState(() =>
    excludeIds?.has(target.parentId) ? '' : target.parentId,
  );
  const selectedFolder = findFolder(tree, selectedId);
  const isSelectionExcluded = excludeIds?.has(selectedId) ?? false;
  const isSameAsCurrent = selectedId === target.parentId;
  const count = target.ids.length;

  return (
    <ModalDialog
      icon="folderPlus"
      eyebrow={`Move ${count} ${count === 1 ? 'item' : 'items'}`}
      title="Choose a folder"
      onClose={onClose}
      width="min(480px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      <div className="ff-field">
        <label className="ff-field__label">Destination folder</label>
        <FolderPicker tree={tree} selectedId={selectedId} onSelect={setSelectedId} excludeIds={excludeIds} />
      </div>
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="ff-btn ff-btn--ghost"
          disabled={!selectedFolder || isSelectionExcluded}
          onClick={() => selectedFolder && onCreateNew(selectedFolder)}
        >
          <Ico name="folderPlus" size={14} /> Create new folder in {selectedFolder?.title ?? '…'}
        </button>
        <button
          type="button"
          className="ff-btn"
          disabled={!selectedFolder || isSelectionExcluded || isSameAsCurrent}
          onClick={() => selectedFolder && onMoveHere(selectedFolder)}
        >
          <Ico name="check" size={14} /> Move here
        </button>
      </div>
    </ModalDialog>
  );
}
