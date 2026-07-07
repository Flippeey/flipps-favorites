import { useState } from 'react';
import type { BookmarkNode, WorkspaceRecord } from '@/shared/messages';
import { FolderMultiPicker } from './FolderMultiPicker';
import { ModalDialog } from './ModalDialog';

interface MoveToDialogProps {
  tree: BookmarkNode[];
  workspaces: WorkspaceRecord[];
  // Number of ids being relocated, for the dialog title only.
  count: number;
  // Folder ids that must not be offered as a destination (the moving folder
  // itself and its own descendants — dropping a folder into itself/a child
  // would orphan it).
  excludeIds?: Set<string>;
  onClose: () => void;
  onConfirm: (targetFolderId: string) => Promise<void>;
}

export function MoveToDialog({ tree, workspaces, count, excludeIds, onClose, onConfirm }: MoveToDialogProps) {
  const [selectedId, setSelectedId] = useState('');
  // Bumped whenever a workspace pill is clicked, forcing FolderMultiPicker to
  // remount so its internal auto-expand seeds from the new selection (it only
  // computes expansion once, on mount).
  const [jumpKey, setJumpKey] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleWorkspaceJump = (rootFolderId: string) => {
    setSelectedId(rootFolderId);
    setJumpKey(k => k + 1);
  };

  const handleToggle = (id: string) => {
    setSelectedId(id);
  };

  const handleConfirm = async (): Promise<void> => {
    if (!selectedId || working) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm(selectedId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move.');
      setWorking(false);
    }
  };

  return (
    <ModalDialog
      icon="folderTree"
      eyebrow="Move to"
      title={`Move ${count} ${count === 1 ? 'item' : 'items'}`}
      onClose={onClose}
      width="min(560px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      {workspaces.length > 1 && (
        <div className="ff-field">
          <label className="ff-field__label">Jump to workspace</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {workspaces.map(ws => {
              const isExcluded = excludeIds?.has(ws.rootFolderId) ?? false;
              return (
                <button
                  key={ws.id}
                  type="button"
                  className="ff-pill"
                  disabled={isExcluded}
                  title={isExcluded ? 'This workspace root is part of what you are moving.' : undefined}
                  onClick={() => handleWorkspaceJump(ws.rootFolderId)}
                >
                  {ws.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="ff-field">
        <label className="ff-field__label">Destination folder</label>
        <FolderMultiPicker
          key={jumpKey}
          tree={tree}
          selectedIds={selectedId ? [selectedId] : []}
          onToggle={handleToggle}
          excludeIds={excludeIds}
        />
      </div>
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="button" className="ff-btn ff-btn--primary" onClick={handleConfirm} disabled={!selectedId || working}>
          {working ? 'Moving…' : 'Move here'}
        </button>
      </div>
    </ModalDialog>
  );
}
