import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { WorkspaceRecord } from '@/shared/messages';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';

interface WorkspaceRenameDialogProps {
  workspace: WorkspaceRecord;
  onClose: () => void;
  onSaved: () => void;
  onRename: (id: string, name: string) => Promise<void>;
}

export function WorkspaceRenameDialog({ workspace, onClose, onSaved, onRename }: WorkspaceRenameDialogProps) {
  const [value, setValue] = useState(workspace.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (saving) return;
    const name = value.trim();
    if (!name) {
      setError('Enter a workspace name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(workspace.id, name);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename workspace.');
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      icon="pencil"
      eyebrow="Rename workspace"
      title={workspace.name}
      onClose={onClose}
      width="min(480px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
      as="form"
      onSubmit={handleSubmit}
    >
      <div className="ff-field">
        <label className="ff-field__label">Name</label>
        <input
          ref={inputRef}
          className="ff-input"
          type="text"
          spellCheck={false}
          value={value}
          onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          placeholder="Workspace name"
        />
      </div>
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="ff-btn" disabled={saving}>
          <Ico name="check" size={14} /> {saving ? 'Saving…' : 'Rename'}
        </button>
      </div>
    </ModalDialog>
  );
}

interface ConfirmDeleteWorkspaceDialogProps {
  workspace: WorkspaceRecord;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function ConfirmDeleteWorkspaceDialog({ workspace, onClose, onConfirm }: ConfirmDeleteWorkspaceDialogProps) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async (): Promise<void> => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete workspace.');
      setWorking(false);
    }
  };

  return (
    <ModalDialog
      icon="trash"
      eyebrow="Delete workspace"
      title={workspace.name}
      onClose={onClose}
      width="min(440px, 100%)"
      bodyStyle={{ gridTemplateColumns: '1fr', gap: 12 }}
    >
      <p className="ff-confirm__message">
        Deleting removes this workspace from the tab bar.
      </p>
      <p className="ff-confirm__hint">Your bookmarks stay in your browser and remain accessible through another workspace.</p>
      {error && <div className="ff-status" data-kind="error" role="alert">{error}</div>}
      <div className="ff-dialog__actions">
        <button type="button" className="ff-btn ff-btn--ghost" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button type="button" className="ff-btn ff-btn--danger" onClick={handleConfirm} disabled={working}>
          <Ico name="trash" size={14} /> {working ? 'Deleting…' : 'Delete workspace'}
        </button>
      </div>
    </ModalDialog>
  );
}
