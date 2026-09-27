import { useState } from 'react';
import type { BookmarkNode, WorkspaceView } from '@/shared/messages';
import { bindWorkspaceFolder } from '../lib/messaging';
import { FolderPicker } from './FolderPicker';
import { ModalDialog } from './ModalDialog';

interface ChooseFolderDialogProps {
  tree: BookmarkNode[];
  workspace: WorkspaceView;
  onClose: () => void;
  onChosen: (workspace: WorkspaceView) => void;
}

// Picks the folder this browser shows for a synced workspace. The choice is
// this browser's alone and never syncs.
export function ChooseFolderDialog({ tree, workspace, onClose, onChosen }: ChooseFolderDialogProps) {
  const [selectedId, setSelectedId] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    if (!selectedId || working) return;
    setWorking(true);
    setError(null);
    try {
      onChosen(await bindWorkspaceFolder(workspace.id, selectedId));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that folder.');
      setWorking(false);
    }
  };

  return (
    <ModalDialog
      icon="folderTree"
      eyebrow="Choose folder"
      title={`Folder for “${workspace.name}” in this browser`}
      onClose={onClose}
      width="min(560px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      <FolderPicker tree={tree} selectedId={selectedId} onSelect={setSelectedId} autoExpand={false} />
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="button" className="ff-btn ff-btn--primary" onClick={handleConfirm} disabled={!selectedId || working}>
          {working ? 'Saving…' : 'Use this folder'}
        </button>
      </div>
    </ModalDialog>
  );
}
