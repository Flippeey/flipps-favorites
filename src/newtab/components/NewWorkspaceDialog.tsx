import { useRef, useState } from 'react';
import type { BookmarkNode } from '../../shared/messages';
import { topLevelFolders } from '../lib/tree';
import { FolderPicker } from './settings';
import { ModalDialog } from './ModalDialog';

interface NewWorkspaceDialogProps {
  tree: BookmarkNode[];
  onConfirm: (rootFolderId: string, name: string) => Promise<void>;
  onClose: () => void;
}

export function NewWorkspaceDialog({ tree, onConfirm, onClose }: NewWorkspaceDialogProps) {
  const topLevel = topLevelFolders(tree);
  const [selectedId, setSelectedId] = useState(topLevel[0]?.id ?? '');
  const [name, setName] = useState(topLevel[0]?.title ?? '');
  const nameEditedRef = useRef(false);

  const handleFolderChange = (id: string) => {
    setSelectedId(id);
    if (!nameEditedRef.current) {
      const folder = topLevel.find(f => f.id === id);
      setName(folder?.title ?? '');
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    nameEditedRef.current = true;
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    const folder = topLevel.find(f => f.id === selectedId);
    await onConfirm(selectedId, name.trim() || folder?.title || 'Workspace');
    onClose();
  };

  return (
    <ModalDialog icon="layers" eyebrow="Workspaces" title="New workspace" onClose={onClose}>
      <div className="ff-field" style={{ marginBottom: 16 }}>
        <label className="ff-field__label">Root folder</label>
        <FolderPicker tree={tree} value={selectedId} onChange={handleFolderChange} />
      </div>
      <div className="ff-field" style={{ marginBottom: 24 }}>
        <label className="ff-field__label">Name (optional)</label>
        <input
          className="ff-input"
          type="text"
          value={name}
          placeholder={topLevel.find(f => f.id === selectedId)?.title ?? 'Workspace'}
          onChange={handleNameChange}
          onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
          autoFocus
        />
      </div>
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="ff-btn ff-btn--primary" onClick={handleConfirm} disabled={!selectedId}>
          Create workspace
        </button>
      </div>
    </ModalDialog>
  );
}
