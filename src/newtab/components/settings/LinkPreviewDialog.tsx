import { Ico } from '../Ico';
import { ModalDialog } from '../ModalDialog';
import { Segmented } from '../settings-controls';
import type { SyncPreviewSummary, WorkspaceImportMode } from '@/newtab/lib/workspace-transfer';

interface LinkPreviewDialogProps {
  // null = the pasted code's namespace is empty (the other browser never pushed).
  preview: SyncPreviewSummary | null;
  mode: WorkspaceImportMode;
  onModeChange: (mode: WorkspaceImportMode) => void;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

function names(list: string[]): string {
  return list.map(n => `“${n}”`).join(', ');
}

// Confirm step of "Link another browser": shows a dry run of what applying
// the other browser's data would change, computed from the payload already
// pulled for the preview (confirming applies that in-memory payload — the
// server is not contacted again until the convergence push).
export function LinkPreviewDialog({ preview, mode, onModeChange, busy, onConfirm, onClose }: LinkPreviewDialogProps) {
  return (
    <ModalDialog
      icon="link"
      eyebrow="Link another browser"
      title={preview ? 'Review what will change' : 'Nothing synced yet'}
      onClose={busy ? () => undefined : onClose}
      width="min(480px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      {preview === null ? (
        <p className="ff-confirm__message">
          The other browser hasn&rsquo;t synced anything yet. Linking makes this browser&rsquo;s data
          the shared copy — press Sync now on the other browser afterwards to pick it up.
        </p>
      ) : (
        <>
          <p className="ff-row__hint" style={{ margin: 0 }}>
            This preview shows what&rsquo;s on the sync server right now — whatever was last synced
            from the other browser.
          </p>
          <div className="ff-row">
            <div>
              <div className="ff-row__label">If both browsers have data</div>
              <div className="ff-row__hint">
                Merge keeps what&rsquo;s here and adds theirs. Replace makes this browser&rsquo;s
                synced setup an exact copy of theirs — workspaces not in their data are removed.
              </div>
            </div>
            <Segmented<WorkspaceImportMode>
              options={[{ id: 'merge', label: 'Merge' }, { id: 'replace', label: 'Replace' }]}
              value={mode}
              onChange={onModeChange}
            />
          </div>
          <ul className="ff-row__hint" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }} data-testid="link-preview-summary">
            <li>
              {preview.newWorkspaceNames.length > 0
                ? `New workspaces: ${names(preview.newWorkspaceNames)}.`
                : 'No new workspaces arrive.'}
            </li>
            {preview.updatedWorkspaceNames.length > 0 && (
              <li>Updated by the other browser&rsquo;s copy: {names(preview.updatedWorkspaceNames)}.</li>
            )}
            {preview.removedWorkspaceNames.length > 0 && (
              <li>
                <strong>Removed</strong> (not in the other browser&rsquo;s data):{' '}
                {names(preview.removedWorkspaceNames)}.
              </li>
            )}
            {preview.workspaceSkippedCount > 0 && (
              <li>{preview.workspaceSkippedCount} incoming workspace(s) skipped — workspace limit reached.</li>
            )}
            <li>
              {preview.iconOverrideIncomingCount} custom icon(s) arrive
              {preview.iconOverrideRemovedCount > 0
                ? `; ${preview.iconOverrideRemovedCount} local custom icon(s) are removed first.`
                : '.'}
            </li>
            <li>{preview.bookmarkUsageIncomingCount} usage entr{preview.bookmarkUsageIncomingCount === 1 ? 'y' : 'ies'} arrive.</li>
            <li>Settings ({mode === 'replace' ? 'reset to defaults, then ' : ''}overlaid with the other browser&rsquo;s values) apply on top of what&rsquo;s here.</li>
          </ul>
          <p className="ff-row__hint" style={{ margin: 0 }}>
            Your bookmarks and folders are never touched by sync — only workspace tabs, settings,
            and custom icons.
          </p>
        </>
      )}
      <p className="ff-sync-warning" style={{ margin: 0 }}>
        This browser&rsquo;s pairing code will be replaced by the one you pasted — afterwards both
        browsers share that code.
      </p>
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="ff-btn ff-btn--primary"
          onClick={onConfirm}
          disabled={busy}
          data-testid="link-preview-confirm"
        >
          <Ico name="link" size={14} /> {busy ? 'Linking…' : 'Link browser'}
        </button>
      </div>
    </ModalDialog>
  );
}
