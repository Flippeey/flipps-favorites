import { useState } from 'react';
import type { BookmarkNode } from '../../shared/messages';
import { countDescendants } from '../lib/tree';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';

interface ConfirmDeleteDialogProps {
  folder: BookmarkNode;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

function describeContents(folder: BookmarkNode): string {
  const { bookmarks, folders } = countDescendants(folder);
  if (bookmarks === 0 && folders === 0) {
    return 'This folder is empty.';
  }
  const parts: string[] = [];
  if (bookmarks > 0) parts.push(`${bookmarks} ${bookmarks === 1 ? 'bookmark' : 'bookmarks'}`);
  if (folders > 0) parts.push(`${folders} ${folders === 1 ? 'subfolder' : 'subfolders'}`);
  return `This will permanently delete ${parts.join(' and ')}.`;
}

export function ConfirmDeleteDialog({ folder, onClose, onConfirm }: ConfirmDeleteDialogProps) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete folder.');
      setWorking(false);
    }
  };

  return (
    <ModalDialog
      icon="trash"
      eyebrow="Delete folder"
      title={folder.title}
      onClose={onClose}
      width="min(440px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      <p className="ff-confirm__message">{describeContents(folder)}</p>
      <p className="ff-confirm__hint">This action cannot be undone.</p>
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="button" className="ff-btn ff-btn--danger" onClick={handleConfirm} disabled={working}>
          <Ico name="trash" size={14} /> {working ? 'Deleting…' : 'Delete folder'}
        </button>
      </div>
    </ModalDialog>
  );
}
