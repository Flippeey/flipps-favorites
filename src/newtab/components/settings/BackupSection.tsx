import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { AppSettings } from '@/shared/messages';
import { SyncFetchError } from '@/shared/messages';
import { adoptSyncSecret, getSyncPairingCode } from '@/newtab/lib/messaging';
import { runSyncNow } from '@/newtab/lib/sync-now';
import { readLastSyncedAt } from '@/shared/storage';
import type { PushToastInput } from '@/newtab/state/useToasts';
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
  pushToast: (input: PushToastInput) => void;
}

type BackupStatus = { kind: 'success' | 'error'; text: string } | null;

// Human copy for each SyncFetchError kind (issue #7 handoff). Kept as a plain
// map rather than a switch so every kind is exhaustively covered in one place.
const SYNC_ERROR_COPY: Record<string, string> = {
  offline: 'Can’t reach the sync server — you appear to be offline.',
  network: 'Can’t reach the sync server. Check your connection and try again.',
  'payload-too-large': 'Your synced data is too large for the server to accept.',
  'rate-limited': 'Too many sync attempts — try again in a bit.',
  'not-found': 'Nothing has been synced yet.',
};

// "4 minutes ago"-style caption for the last successful sync. Coarse on
// purpose: the caption answers "did it work / roughly when", not "exactly when".
function describeLastSynced(timestamp: number | null): string {
  if (timestamp === null) return 'Never synced on this browser.';
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) return 'Last synced just now on this browser.';
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `Last synced ${String(minutes)} minute${minutes === 1 ? '' : 's'} ago on this browser.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last synced ${String(hours)} hour${hours === 1 ? '' : 's'} ago on this browser.`;
  return `Last synced ${new Date(timestamp).toLocaleDateString()} on this browser.`;
}

function describeSyncError(error: unknown): string {
  if (error instanceof SyncFetchError) {
    const known = SYNC_ERROR_COPY[error.kind];
    if (known) return known;
    if (error.kind === 'http-status') {
      return `Sync server error${error.httpStatus ? ` (${String(error.httpStatus)})` : ''}. Try again later.`;
    }
    return 'Something went wrong while syncing. Try again later.';
  }
  return error instanceof Error ? error.message : 'Something went wrong while syncing.';
}

export function BackupSection({ onAfterImport, pushToast }: BackupSectionProps) {
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'importing'>('idle');
  const [status, setStatus] = useState<BackupStatus>(null);
  const [importMode, setImportMode] = useState<WorkspaceImportMode>('merge');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [syncBusy, setSyncBusy] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingRevealed, setPairingRevealed] = useState(false);
  const [pairingCodeBusy, setPairingCodeBusy] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkConfirming, setLinkConfirming] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    readLastSyncedAt()
      .then((ts) => { if (!cancelled) setLastSyncedAt(ts); })
      .catch(() => { /* caption stays at "Never synced" — not worth an error state */ });
    return () => { cancelled = true; };
  }, []);

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
      const skippedTotal = summary.workspaceSkippedCount + summary.workspaceFailedCount + summary.iconOverrideSkippedCount;
      const skippedSuffix = skippedTotal > 0
        ? ` ${String(skippedTotal)} item${skippedTotal === 1 ? '' : 's'} skipped (over the workspace limit or too large) and were not imported.`
        : '';
      setStatus({
        kind: 'success',
        text: `Imported ${String(summary.workspaceCount)} ${wsLabel} and ${String(summary.iconOverrideCount)} ${overrideLabel} (${summary.mode} mode).${skippedSuffix}`,
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

  const handleSyncNow = async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    try {
      const result = await runSyncNow();
      if (result.merged) {
        onAfterImport(result.settings);
      }
      setLastSyncedAt(Date.now());
      pushToast({ kind: 'info', message: 'Synced.' });
    } catch (error) {
      pushToast({ kind: 'error', message: describeSyncError(error) });
    } finally {
      setSyncBusy(false);
    }
  };

  const handleRevealPairingCode = async () => {
    if (pairingRevealed) { setPairingRevealed(false); return; }
    if (pairingCode) { setPairingRevealed(true); return; }
    setPairingCodeBusy(true);
    try {
      const code = await getSyncPairingCode();
      setPairingCode(code);
      setPairingRevealed(true);
    } catch (error) {
      pushToast({ kind: 'error', message: describeSyncError(error) });
    } finally {
      setPairingCodeBusy(false);
    }
  };

  const handleCopyPairingCode = async () => {
    if (!pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingCode);
      pushToast({ kind: 'info', message: 'Pairing code copied.' });
    } catch {
      pushToast({ kind: 'error', message: 'Couldn’t copy the pairing code.' });
    }
  };

  const handleLinkSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (linkBusy || !linkInput.trim()) return;
    if (!linkConfirming) {
      setLinkConfirming(true);
      return;
    }
    setLinkBusy(true);
    setLinkError(null);
    try {
      await adoptSyncSecret(linkInput.trim());
      const result = await runSyncNow();
      if (result.merged) {
        onAfterImport(result.settings);
      }
      setLinkInput('');
      setLinkConfirming(false);
      // A newly adopted pairing means any cached code/reveal state is stale.
      setPairingCode(null);
      setPairingRevealed(false);
      setLastSyncedAt(Date.now());
      pushToast({ kind: 'info', message: 'Linked and synced with the other browser.' });
    } catch (error) {
      if (error instanceof SyncFetchError && error.kind === 'validation') {
        setLinkError('That pairing code doesn’t look right. Double-check it and try again.');
      } else {
        pushToast({ kind: 'error', message: describeSyncError(error) });
      }
      setLinkConfirming(false);
    } finally {
      setLinkBusy(false);
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
            <div className="ff-row__hint">Merge keeps existing data and overlays the file. Replace wipes settings and icon overrides first. Workspaces always merge by ID — your current workspaces are never deleted.</div>
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

      <h3 className="ff-set-section__title" style={{ marginTop: 32 }}>Sync</h3>
      <p className="ff-set-section__desc">
        End-to-end encrypted sync between your own browsers, via our server. The server only ever
        stores encrypted bytes — it can never read your workspaces, bookmarks, or icons.
        {' '}<strong>Synced:</strong> settings, workspaces, wallpapers, icon overrides, and usage stats.
        {' '}<strong>Not synced:</strong> your browser&rsquo;s actual bookmarks — each workspace points at a
        folder in this browser&rsquo;s bookmarks, so on a newly linked browser a workspace may need repointing.
      </p>

      <div className="ff-card" style={{ marginBottom: 16 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Sync now</div>
            <div className="ff-row__hint">
              Pulls the latest synced data, merges it with what&rsquo;s here, then pushes the result.
              If the same item changed on two browsers, whichever browser synced last takes over —
              syncing never deletes anything.
            </div>
          </div>
          <button
            type="button"
            className="ff-btn ff-btn--ghost"
            onClick={handleSyncNow}
            disabled={syncBusy}
            data-testid="sync-now-button"
          >
            <Ico name="refresh" size={14} /> {syncBusy ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        <p className="ff-row__hint" style={{ marginTop: 8, marginBottom: 0 }} data-testid="last-synced-caption">
          {describeLastSynced(lastSyncedAt)}
        </p>
      </div>

      <div className="ff-card" style={{ marginBottom: 16 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Pairing code</div>
            <div className="ff-row__hint">Use this on another browser to link it to this sync data.</div>
          </div>
          <button
            type="button"
            className="ff-btn ff-btn--ghost"
            onClick={handleRevealPairingCode}
            disabled={pairingCodeBusy}
            data-testid="reveal-pairing-code-button"
          >
            <Ico name={pairingRevealed ? 'eyeOff' : 'eye'} size={14} />
            {pairingCodeBusy ? 'Loading…' : pairingRevealed ? 'Hide' : 'Reveal'}
          </button>
        </div>
        {pairingRevealed && pairingCode && (
          <div className="ff-sync-pairing" data-testid="pairing-code-value">
            <code className="ff-sync-pairing__code">{pairingCode}</code>
            <button type="button" className="ff-iconbtn ff-iconbtn--icon" aria-label="Copy pairing code" title="Copy" onClick={handleCopyPairingCode}>
              <Ico name="copy" size={14} />
            </button>
          </div>
        )}
        <p className="ff-sync-warning">
          Treat this code like a password. Anyone who has it can read <em>and overwrite</em> your synced data.
        </p>
      </div>

      <div className="ff-card">
        <form onSubmit={handleLinkSubmit}>
          <div className="ff-stackrow">
            <div className="ff-row__label">Link another browser</div>
            <div className="ff-row__hint" style={{ marginBottom: 8 }}>
              Paste a pairing code from another browser to join its sync data. This browser&rsquo;s own
              pairing code is replaced by the one you paste — afterwards both browsers share that same
              code. Your data merges; nothing here is deleted.
            </div>
            <div className="ff-field">
              <input
                className="ff-input"
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={linkInput}
                onChange={(e) => { setLinkInput(e.target.value); setLinkError(null); setLinkConfirming(false); }}
                disabled={linkBusy}
                data-testid="link-pairing-code-input"
              />
            </div>
            {linkError && <div className="ff-status" data-kind="error" role="alert">{linkError}</div>}
            {linkConfirming && !linkError && (
              <div className="ff-status" data-kind="warning" role="alert">
                This replaces this browser&rsquo;s pairing code with the pasted one and merges that
                browser&rsquo;s data in. Continue?
              </div>
            )}
            <div className="ff-dialog__actions" style={{ marginTop: 8 }}>
              <button
                type="submit"
                className="ff-btn ff-btn--ghost"
                disabled={linkBusy || !linkInput.trim()}
                data-testid="link-browser-submit"
              >
                <Ico name="link" size={14} />
                {linkBusy ? 'Linking…' : linkConfirming ? 'Confirm link' : 'Link browser'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
