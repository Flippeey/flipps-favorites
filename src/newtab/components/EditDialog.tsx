import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../interaction/useEscapeKey';
import type { BookmarkNode, IconSearchCandidate, IconSourceKind, ResolvedIcon } from '@/shared/messages';
import { getRegistrableDomain, getScopeHostname, type IconOverrideScope } from '@/shared/icon-scope';
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
  iconPersistenceErrorMessage,
  isValidBookmarkUrl,
  normalizeUploadedImage,
} from '../lib/icon-helpers';
import { buildBrandSearchQuery } from '@/shared/url-brand';
import { invalidateFaviconCache, invalidateFaviconCacheForScope } from '../lib/favicon-cache';
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
  // Same subdomain-aware query the auto-resolve pipeline uses, so the dialog seeds
  // 'google calendar logo' for calendar.google.com — not the bare 'google logo'.
  const brandQuery = buildBrandSearchQuery(url);
  if (brandQuery) return brandQuery;
  const seed = title.trim() || getHostname(url);
  return `${seed} logo`.trim();
}

const ICON_SOURCE_LABELS: Record<IconSourceKind, string> = {
  override: 'Custom upload',
  origin: 'Site icon',
  iconhorse: 'Icon Horse',
  favicon: 'Google favicons',
  search: 'Web search',
  generated: 'Placeholder',
};

export function EditDialog({ target, onClose, onSaved }: EditDialogProps) {
  const [title, setTitle] = useState(target.title);
  const [url, setUrl] = useState(target.url);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const [query, setQuery] = useState(() => defaultQuery(target.title, target.url));
  const [results, setResults] = useState<IconSearchCandidate[]>([]);
  const [validatedPreviews, setValidatedPreviews] = useState<Set<string>>(new Set());
  const [searching, setSearching] = useState(false);
  const [previewIcon, setPreviewIcon] = useState<ResolvedIcon | null>(null);
  const [working, setWorking] = useState(false);
  // Default to host scope: picking an icon once should fix every bookmark on the
  // same site (5 dev.azure.com bookmarks = 1 override, not 5).
  const [overrideScope, setOverrideScope] = useState<IconOverrideScope>('host');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const bookmarkUrl = target.url;
  const bookmarkTitle = target.title;

  useEscapeKey(onClose);

  const runSearch = useCallback(async (q: string) => {
    setSearching(true);
    setValidatedPreviews(new Set());
    try {
      const candidates = await searchIcons(q, bookmarkUrl);
      setResults(candidates);
      // Count is shown in the Search-icons header; only surface a status when there's nothing.
      setStatus(candidates.length ? null : { kind: 'error', message: 'No matches.' });
    } catch {
      setResults([]);
      setStatus({ kind: 'error', message: 'Search failed.' });
    } finally {
      setSearching(false);
    }
  }, [bookmarkUrl]);

  const handlePreviewLoad = useCallback((imageUrl: string, image: HTMLImageElement) => {
    const minEdge = Math.min(image.naturalWidth, image.naturalHeight);
    if (minEdge < 64) return;
    setValidatedPreviews(prev => {
      if (prev.has(imageUrl)) return prev;
      const next = new Set(prev);
      next.add(imageUrl);
      return next;
    });
  }, []);

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
      if (bookmark.url) {
        invalidateFaviconCache(bookmark.url);
        // Pre-warm: start auto icon resolution so the tile already has a real
        // icon by the time the user lands back on the newtab grid.
        void getIcon(bookmark.url, bookmark.title).catch(() => undefined);
      }
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
        scope: overrideScope,
      });
      setPreviewIcon(icon);
      invalidateFaviconCacheForScope(bookmarkUrl, overrideScope);
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
      // Removal clears every scope, so refresh all tiles that could share it.
      invalidateFaviconCacheForScope(bookmarkUrl, 'domain');
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
        scope: overrideScope,
      });
      setPreviewIcon(icon);
      invalidateFaviconCacheForScope(bookmarkUrl, overrideScope);
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
  const scopeHostname = getScopeHostname(bookmarkUrl);
  const scopeDomain = getRegistrableDomain(scopeHostname);
  const scopeOptions: Array<{ value: IconOverrideScope; label: string; title: string }> = [
    { value: 'exact', label: 'This bookmark', title: 'Apply the icon to this bookmark only' },
    ...(scopeHostname
      ? [{ value: 'host' as const, label: scopeHostname, title: `Apply to every bookmark on ${scopeHostname}` }]
      : []),
    ...(scopeDomain && scopeDomain !== scopeHostname
      ? [{ value: 'domain' as const, label: `*.${scopeDomain}`, title: `Apply to every bookmark under ${scopeDomain}` }]
      : []),
  ];

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
                  // Cap, don't stretch: an <img> with no fixed width renders at its
                  // native pixel size, so low-res icons stay sharp instead of being
                  // upscaled to fill the box; large icons still shrink to fit.
                  style={{ maxWidth: '70%', maxHeight: '70%', objectFit: 'contain' }}
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

            {canManageIcon && scopeOptions.length > 1 && (
              <div className="ff-field">
                <label className="ff-field__label">Apply icon to</label>
                <div className="ff-segmented" role="radiogroup" aria-label="Icon override scope" style={{ alignSelf: 'stretch' }}>
                  {scopeOptions.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className="ff-segmented__option"
                      data-active={overrideScope === option.value}
                      title={option.title}
                      onClick={() => setOverrideScope(option.value)}
                      style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {canManageIcon && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  textAlign: 'center',
                  letterSpacing: 0.2,
                }}
              >
                Hover the preview for quick icon actions.
              </p>
            )}

            {previewIcon && (
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: 'var(--fg-3)',
                  textAlign: 'center',
                  letterSpacing: 0.2,
                }}
                title={`Icon source: ${ICON_SOURCE_LABELS[previewIcon.sourceKind]}`}
              >
                Source: {ICON_SOURCE_LABELS[previewIcon.sourceKind]}
                {previewIcon.sourceKind === 'generated' && ' — try Search or Upload for a real icon.'}
              </p>
            )}

            {status && (
              <div className="ff-status" data-kind={status.kind} role="status">
                {status.message}
              </div>
            )}

            <button className="ff-btn" disabled={saving} onClick={handleSave} title="Save bookmark">
              <Ico name="check" size={14} /> {saving ? 'Saving…' : 'Save bookmark'}
            </button>
          </aside>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
                  Search icons
                </h4>
                {results.length > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--fg-3)', flexShrink: 0 }}>
                    {results.length} candidate{results.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                Search the web for icons and favicons. Click any result to apply instantly.
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
              <button className="ff-btn ff-btn--ghost" type="submit" disabled={!canManageIcon || searching || !query.trim()} title="Search for icons">
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
              <div className="ff-icongrid" style={{ overflowY: 'auto' }}>
                {results.map((candidate) => {
                  const isValidated = validatedPreviews.has(candidate.imageUrl);
                  return (
                    <button
                      key={candidate.imageUrl}
                      type="button"
                      className="ff-icongrid__cell"
                      title={candidate.label}
                      onClick={() => handlePickCandidate(candidate)}
                      disabled={working}
                      style={{ display: isValidated ? undefined : 'none' }}
                    >
                      <img
                        src={candidate.previewUrl}
                        alt=""
                        referrerPolicy="no-referrer"
                        onLoad={(e) => handlePreviewLoad(candidate.imageUrl, e.currentTarget)}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
    </ModalDialog>
  );
}
