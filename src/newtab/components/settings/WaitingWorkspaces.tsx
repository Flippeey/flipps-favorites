import { useState } from 'react';
import type { BookmarkNode, WorkspaceView } from '@/shared/messages';
import { setWorkspaceNotUsed } from '@/newtab/lib/messaging';
import type { PushToastInput } from '@/newtab/state/useToasts';
import { ChooseFolderDialog } from '../ChooseFolderDialog';

interface WaitingWorkspacesProps {
  waiting: WorkspaceView[];
  tree: BookmarkNode[];
  onChanged: () => void;
  pushToast: (input: PushToastInput) => void;
}

// Synced workspaces whose folder isn't in this browser's bookmarks yet.
export function WaitingWorkspaces({ waiting, tree, onChanged, pushToast }: WaitingWorkspacesProps) {
  const [choosing, setChoosing] = useState<WorkspaceView | null>(null);
  if (!waiting.length) return null;

  const handleNotUsed = async (workspace: WorkspaceView): Promise<void> => {
    try {
      await setWorkspaceNotUsed(workspace.id, true);
      onChanged();
    } catch {
      pushToast({ kind: 'error', message: 'Couldn’t save that choice.' });
    }
  };

  return (
    <div className="ff-card" style={{ marginBottom: 16 }} data-testid="waiting-workspaces">
      <p className="ff-row__hint" style={{ marginTop: 0 }}>
        {waiting.length === 1 ? '1 synced workspace needs' : `${String(waiting.length)} synced workspaces need`} a
        folder in this browser — import your bookmarks or choose one.
      </p>
      {waiting.map(workspace => (
        <div className="ff-row" key={workspace.id}>
          <div className="ff-row__label">{workspace.name}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="ff-btn ff-btn--ghost" onClick={() => setChoosing(workspace)}>Choose folder</button>
            <button type="button" className="ff-btn ff-btn--ghost" onClick={() => { void handleNotUsed(workspace); }}>
              Not used in this browser
            </button>
          </div>
        </div>
      ))}
      {choosing && (
        <ChooseFolderDialog tree={tree} workspace={choosing} onClose={() => setChoosing(null)} onChosen={onChanged} />
      )}
    </div>
  );
}
