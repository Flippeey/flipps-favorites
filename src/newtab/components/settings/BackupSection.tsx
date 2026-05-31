import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { AppSettings } from '@/shared/messages';
import {
  applyWorkspaceImport,
  buildWorkspaceExport,
  downloadWorkspaceExport,
  parseWorkspaceFile,
  type WorkspaceImportMode,
} from '@/newtab/lib/workspace-transfer';
import { Ico } from '../Ico';
import { Segmented } from '../settings-controls';

interface BackupSectionProps {
  onAfterImport: (settings: AppSettings) => void;
}

type BackupStatus = { kind: 'success' | 'error'; text: string } | null;

export function BackupSection({ onAfterImport }: BackupSectionProps) {
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'importing'>('idle');
  const [status, setStatus] = useState<BackupStatus>(null);
  const [importMode, setImportMode] = useState<WorkspaceImportMode>('merge');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!status) return;
    const id = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(id);
  }, [status]);

  const handleExport = async () => {
    if (busy !== 'idle') return;
    setBusy('exporting');
    setStatus(null);
    try {
      const payload = await buildWorkspaceExport();
      downloadWorkspaceExport(payload);
      const wsLabel = payload.workspaces.length === 1 ? 'workspace' : 'workspaces';
      const overrideLabel = payload.iconOverrides.length === 1 ? 'icon override' : 'icon overrides';
      setStatus({
        kind: 'success',
        text: `Exported ${String(payload.workspaces.length)} ${wsLabel} and ${String(payload.iconOverrides.length)} ${overrideLabel}.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to export settings.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const handlePickFile = () => {
    if (busy !== 'idle') return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('importing');
    setStatus(null);
    try {
      const payload = await parseWorkspaceFile(file);
      const summary = await applyWorkspaceImport(payload, importMode);
      onAfterImport(summary.settings);
      const wsLabel = summary.workspaceCount === 1 ? 'workspace' : 'workspaces';
      const overrideLabel = summary.iconOverrideCount === 1 ? 'icon override' : 'icon overrides';
      setStatus({
        kind: 'success',
        text: `Imported ${String(summary.workspaceCount)} ${wsLabel} and ${String(summary.iconOverrideCount)} ${overrideLabel} (${summary.mode} mode).`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to import settings.',
      });
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Backup</h3>
      <p className="ff-set-section__desc">
        Save all your workspaces, settings, and icon overrides to a file, or restore from one. Bookmarks
        and folders sync through the browser — use the browser&rsquo;s built-in bookmark export to move them.
      </p>

      <div className="ff-card" style={{ marginBottom: 16 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Export settings</div>
            <div className="ff-row__hint">Downloads a JSON file with all workspaces, icon overrides, and usage history.</div>
          </div>
          <button
            type="button"
            className="ff-btn ff-btn--ghost"
            onClick={handleExport}
            disabled={busy !== 'idle'}
          >
            <Ico name="download" size={14} /> {busy === 'exporting' ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>

      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Import mode</div>
            <div className="ff-row__hint">Merge keeps existing data and overlays the file. Replace wipes settings and icon overrides first.</div>
          </div>
          <Segmented<WorkspaceImportMode>
            options={[{ id: 'merge', label: 'Merge' }, { id: 'replace', label: 'Replace' }]}
            value={importMode}
            onChange={setImportMode}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Import settings</div>
            <div className="ff-row__hint">Restore from a previously exported Flipp&rsquo;s Favorites backup.</div>
          </div>
          <button
            type="button"
            className="ff-btn ff-btn--ghost"
            onClick={handlePickFile}
            disabled={busy !== 'idle'}
          >
            <Ico name="upload" size={14} /> {busy === 'importing' ? 'Importing…' : 'Import…'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {status && (
        <div
          role="status"
          style={{
            marginTop: 12,
            fontSize: 12,
            color: status.kind === 'error' ? 'var(--danger, #C75252)' : 'var(--fg-2)',
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}
