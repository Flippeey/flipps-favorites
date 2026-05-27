import { useMemo, useRef, useState } from 'react';
import type { BookmarkNode, WorkspaceRecord } from '../../shared/messages';
import { scanFolders } from '../lib/folder-scoring';
import { findFolder, topLevelFolders } from '../lib/tree';
import { ModalDialog } from './ModalDialog';
import { WorkspaceRecommendations } from './Onboarding';

interface NewWorkspaceDialogProps {
  tree: BookmarkNode[];
  workspaces: WorkspaceRecord[];
  onConfirm: (rootFolderId: string, name: string) => Promise<string | undefined>;
  onClose: () => void;
}

export function NewWorkspaceDialog({ tree, workspaces, onConfirm, onClose }: NewWorkspaceDialogProps) {
  const excludeIds = useMemo(
    () => new Set(workspaces.map(w => w.rootFolderId)),
    [workspaces],
  );

  const scanResult = useMemo(() => scanFolders(tree), [tree]);

  const filteredPreSelected = useMemo(
    () => scanResult.preSelected.filter(f => !excludeIds.has(f.id)),
    [scanResult, excludeIds],
  );
  const filteredSuggested = useMemo(
    () => scanResult.suggested.filter(f => !excludeIds.has(f.id)),
    [scanResult, excludeIds],
  );

  const defaultId = useMemo(() => (
    filteredPreSelected[0]?.id
    ?? filteredSuggested[0]?.id
    ?? topLevelFolders(tree).find(f => !excludeIds.has(f.id))?.id
    ?? ''
  ), [filteredPreSelected, filteredSuggested, tree, excludeIds]);

  const [selectedId, setSelectedId] = useState(defaultId);
  const [name, setName] = useState(() => findFolder(tree, defaultId)?.title ?? '');
  const nameEditedRef = useRef(false);

  const handleFolderSelect = (id: string) => {
    setSelectedId(id);
    if (!nameEditedRef.current) {
      setName(findFolder(tree, id)?.title ?? '');
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    nameEditedRef.current = true;
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    const folder = findFolder(tree, selectedId);
    await onConfirm(selectedId, name.trim() || folder?.title || 'Workspace');
    onClose();
  };

  return (
    <ModalDialog
      icon="layers"
      eyebrow="Workspaces"
      title="New workspace"
      onClose={onClose}
      bodyStyle={{ gridTemplateColumns: '1fr' }}
    >
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 12 }}>
          Select a folder to use as the workspace root:
        </div>
        <WorkspaceRecommendations
          tree={tree}
          preSelected={filteredPreSelected}
          suggested={filteredSuggested}
          selectedIds={selectedId ? [selectedId] : []}
          excludeIds={excludeIds}
          onToggle={handleFolderSelect}
        />
      </div>
      <div className="ff-field" style={{ marginTop: 8 }}>
        <label className="ff-field__label">Name (optional)</label>
        <input
          className="ff-input"
          type="text"
          value={name}
          placeholder={findFolder(tree, selectedId)?.title ?? 'Workspace'}
          onChange={handleNameChange}
          onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
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
