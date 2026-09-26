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
  onClose: () => void;
  onMoveHere: (folder: BookmarkNode) => void;
  onCreateNew: (folder: BookmarkNode) => void;
}

export function MoveToFolderDialog({ tree, target, onClose, onMoveHere, onCreateNew }: MoveToFolderDialogProps) {
  const [selectedId, setSelectedId] = useState(target.parentId);
  const selectedFolder = findFolder(tree, selectedId);
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
        <FolderPicker tree={tree} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="ff-btn ff-btn--ghost"
          disabled={!selectedFolder}
          onClick={() => selectedFolder && onCreateNew(selectedFolder)}
        >
          <Ico name="folderPlus" size={14} /> Create new folder in {selectedFolder?.title ?? '…'}
        </button>
        <button
          type="button"
          className="ff-btn"
          disabled={!selectedFolder}
          onClick={() => selectedFolder && onMoveHere(selectedFolder)}
        >
          <Ico name="check" size={14} /> Move here
        </button>
      </div>
    </ModalDialog>
  );
}
