import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../interaction/useEscapeKey';
import type { BookmarkNode, IconSearchCandidate, ResolvedIcon } from '../../shared/messages';
import {
  createBookmark,
  getIcon,
  invalidateIcon,
  removeIconOverride,
  searchIcons,
  setIconOverride,
  setIconOverrideFromUrl,
  updateBookmark,
} from '../lib/messaging';
import {
  getHostname,
  getSearchName,
  iconPersistenceErrorMessage,
  isValidBookmarkUrl,
  normalizeUploadedImage,
} from '../lib/icon-helpers';
import { invalidateFaviconCache } from './Favicon';
import { Ico } from './Ico';
import { ModalDialog } from './ModalDialog';

export interface EditTarget {
  id?: string;
  parentId?: string;
  title: string;
  url: string;
}

interface EditDialogProps {
  target: EditTarget;
  onClose: () => void;
  onSaved: (bookmark: BookmarkNode) => void;
}

type StatusKind = 'info' | 'success' | 'error';
type Status = { message: string; kind: StatusKind } | null;

function defaultQuery(title: string, url: string): string {
  const seed = getSearchName(url) || title.trim() || getHostname(url);
  return `${seed} logo`.trim();
}

export function EditDialog({ target, onClose, onSaved }: EditDialogProps) {
  const [title, setTitle] = useState(target.title);
  const [url, setUrl] = useState(target.url);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const [query, setQuery] = useState(() => defaultQuery(target.title, target.url));
  const [results, setResults] = useState<IconSearchCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [previewIcon, setPreviewIcon] = useState<ResolvedIcon | null>(null);
  const [working, setWorking] = useState(false);
  const [visibleCount, setVisibleCount] = useState(12);

  const pageSize = 12;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const bookmarkUrl = target.url;
  const bookmarkTitle = target.title;

  useEscapeKey(onClose);

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    setVisibleCount(pageSize);
    try {
      const candidates = await searchIcons(q, bookmarkUrl);
      setResults(candidates);
      setStatus({
        kind: candidates.length ? 'info' : 'error',
        message: candidates.length
          ? `Found ${candidates.length} icon candidates.`
          : 'No matches.',
      });
    } catch {
      setResults([]);
      setStatus({ kind: 'error', message: 'Search failed.' });
    } finally {
      setSearching(false);
    }
  }, [bookmarkUrl]);

  const loadPreview = useCallback(async () => {
    if (!bookmarkUrl) return;
    try {
      const icon = await getIcon(bookmarkUrl, bookmarkTitle);
      setPreviewIcon(icon);
    } catch {
      // ignore
    }
  }, [bookmarkUrl, bookmarkTitle]);

  // Initial: load preview + run search (only for existing bookmarks with a real URL)
  useEffect(() => {
    if (!target.id || !isValidBookmarkUrl(bookmarkUrl)) return;
    loadPreview();
    runSearch(defaultQuery(bookmarkTitle, bookmarkUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.id]);

  const handleSave = async () => {
    if (!title.trim()) {
      setStatus({ kind: 'error', message: 'Name is required.' });
      return;
    }
    if (!isValidBookmarkUrl(url.trim())) {
      setStatus({ kind: 'error', message: 'URL is not valid.' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      let bookmark: BookmarkNode;
      if (target.id) {
        bookmark = await updateBookmark(target.id, { title, url });
      } else {
        bookmark = await createBookmark(target.parentId ?? '1', title, url);
      }
      invalidateFaviconCache(bookmarkUrl);
      if (bookmark.url) invalidateFaviconCache(bookmark.url);
      onSaved(bookmark);
    } catch (e: unknown) {
      setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not save bookmark.' });
    } finally {
      setSaving(false);
    }
  };

  const handlePickCandidate = async (candidate: IconSearchCandidate) => {
    if (!target.id || working) return;
    setWorking(true);
    try {
      const icon = await setIconOverrideFromUrl({
        bookmarkUrl,
        bookmarkTitle,
        imageUrl: candidate.imageUrl,
        fallbackImageUrl: candidate.previewUrl !== candidate.imageUrl ? candidate.previewUrl : undefined,
      });
      setPreviewIcon(icon);
      invalidateFaviconCache(bookmarkUrl);
      setStatus({ kind: 'success', message: 'Icon applied.' });
    } catch (e) {
      setStatus({ kind: 'error', message: iconPersistenceErrorMessage(e, 'search') });
    } finally {
      setWorking(false);
    }
  };

  const handleRefreshIcon = async () => {
    if (!target.id || working) return;
    setWorking(true);
    try {
      await invalidateIcon(bookmarkUrl);
      const icon = await getIcon(bookmarkUrl, bookmarkTitle);
      setPreviewIcon(icon);
      invalidateFaviconCache(bookmarkUrl);
      setStatus({ kind: 'info', message: 'Icon refreshed.' });
    } catch {
      setStatus({ kind: 'error', message: 'Could not refresh icon.' });
    } finally {
      setWorking(false);
    }
  };

  const handleRemoveOverride = async () => {
    if (!target.id || working) return;
    setWorking(true);
    try {
      const icon = await removeIconOverride(bookmarkUrl, bookmarkTitle);
      setPreviewIcon(icon);
      invalidateFaviconCache(bookmarkUrl);
      setStatus({ kind: 'info', message: 'Icon override removed.' });
    } catch {
      setStatus({ kind: 'error', message: 'Could not remove icon override.' });
    } finally {
      setWorking(false);
    }
  };

  const handleUploadClick = () => {
    if (!target.id || working) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !target.id || working) return;
    setWorking(true);
    try {
      const dataUrl = await normalizeUploadedImage(file);
      const icon = await setIconOverride({
        bookmarkUrl,
        bookmarkTitle,
        dataUrl,
        fileName: file.name,
        mimeType: 'image/png',
      });
      setPreviewIcon(icon);
      invalidateFaviconCache(bookmarkUrl);
      setStatus({ kind: 'success', message: 'Icon uploaded.' });
    } catch (e) {
      setStatus({ kind: 'error', message: iconPersistenceErrorMessage(e, 'upload') });
    } finally {
      setWorking(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    runSearch(query.trim());
  };

  const canManageIcon = Boolean(target.id);
  const previewSrc = previewIcon?.dataUrl ?? null;

  return (
    <ModalDialog
      icon="pencil"
      eyebrow={target.id ? 'Edit bookmark' : 'New bookmark'}
      title={title || 'Untitled'}
      onClose={onClose}
    >
          <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="ff-field">
              <label className="ff-field__label">Name</label>
              <input className="ff-input" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="ff-field">
              <label className="ff-field__label">URL</label>
              <input className="ff-input" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>

            <div className="ff-iconpreview" aria-label="Icon preview">
              {previewSrc ? (
                <img
                  src={previewSrc}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{ width: '70%', height: '70%', objectFit: 'contain' }}
                />
              ) : (
                <span className="ff-iconpreview__fallback">
                  {(title?.[0] ?? '?').toUpperCase()}
                </span>
              )}
              {canManageIcon && (
                <div className="ff-iconpreview__hover">
                  <button type="button" onClick={handleRefreshIcon} aria-label="Refresh icon" title="Refresh icon">
                    <Ico name="refresh" size={14} />
                    <span>Refresh</span>
                  </button>
                  <button type="button" onClick={handleRemoveOverride} aria-label="Remove icon override" title="Remove icon override">
                    <Ico name="trash" size={14} />
                    <span>Remove</span>
                  </button>
                  <button type="button" onClick={handleUploadClick} aria-label="Upload icon" title="Upload icon" style={{ gridColumn: 'span 2' }}>
                    <Ico name="upload" size={14} />
                    <span>Upload</span>
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />

            {status && (
              <div className="ff-status" data-kind={status.kind} role="status">
                {status.message}
              </div>
            )}

            <button className="ff-btn" disabled={saving} onClick={handleSave}>
              <Ico name="check" size={14} /> {saving ? 'Saving…' : 'Save bookmark'}
            </button>
          </aside>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
            <div>
              <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
                Search
              </h4>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                Search for an icon or favicon and click a result to apply it immediately.
              </p>
            </div>

            <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: 8 }}>
              <input
                className="ff-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for an icon"
                style={{ flex: 1 }}
                disabled={!canManageIcon}
              />
              <button className="ff-btn" type="submit" disabled={!canManageIcon || searching || !query.trim()}>
                <Ico name="search" size={14} />
                <span>Search</span>
              </button>
            </form>

            {!canManageIcon ? (
              <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
                Save the bookmark first to manage its icon.
              </p>
            ) : searching ? (
              <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>Searching for icons…</p>
            ) : results.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>No results yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
                <div className="ff-icongrid" style={{ overflowY: 'auto' }}>
                  {results.slice(0, visibleCount).map((candidate) => (
                    <button
                      key={candidate.imageUrl}
                      type="button"
                      className="ff-icongrid__cell"
                      title={candidate.label}
                      onClick={() => handlePickCandidate(candidate)}
                      disabled={working}
                    >
                      <img
                        src={candidate.previewUrl}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </button>
                  ))}
                </div>
                {visibleCount < results.length && (
                  <button
                    type="button"
                    className="ff-btn"
                    onClick={() => setVisibleCount((current) => Math.min(current + pageSize, results.length))}
                    style={{ alignSelf: 'center' }}
                  >
                    Load more ({String(results.length - visibleCount)} remaining)
                  </button>
                )}
              </div>
            )}
          </div>
    </ModalDialog>
  );
}
