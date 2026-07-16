import type { FormEvent, ReactNode, RefObject } from 'react';
import type { IconSearchCandidate } from '@/shared/messages';
import type { TileShape } from '@/shared/models';
import { IS_FIREFOX } from '@/newtab/lib/platform';
import { Ico } from './Ico';

// Shared icon-picking UI (upload + DDG search grid) extracted out of EditDialog
// so FolderNameDialog can reuse the exact same preview/search chrome. Rendered
// as two "sections" rather than one combined block because the two halves live
// in different grid columns of the owning ModalDialog — each call renders
// exactly what used to be inline at that spot, so the DOM/classnames are
// unchanged for existing bookmark-icon Playwright specs.

function radiusForShape(shape: TileShape | undefined): string {
  switch (shape) {
    case 'circle':   return '50%';
    case 'rounded':  return '16%';
    case 'squircle':
    default:         return '22%';
  }
}

function candidateSourceLabel(candidate: { sourceKind: 'favicon' | 'search'; sourcePageUrl?: string }): string {
  if (candidate.sourceKind === 'favicon') return 'Google favicons';
  const base = 'Web search';
  if (candidate.sourcePageUrl) {
    try {
      const host = new URL(candidate.sourcePageUrl).hostname;
      if (host) return `${base} · ${host}`;
    } catch {
      // malformed URL — fall through to base label
    }
  }
  return base;
}

interface IconPreviewSectionProps {
  section: 'preview';
  tileShape?: TileShape;
  previewSrc: string | null;
  fallbackLetter: string;
  canManage: boolean;
  onRefresh?: () => void;
  onRemove: () => void;
  onUploadClick: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  hintText: ReactNode;
  scopeControl?: ReactNode;
  sourceInfo?: ReactNode;
}

interface IconSearchSectionProps {
  section: 'search';
  canManage: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSearchSubmit: () => void;
  searching: boolean;
  results: IconSearchCandidate[];
  validatedPreviews: ReadonlySet<string>;
  onPreviewLoad: (imageUrl: string, image: HTMLImageElement) => void;
  onPickCandidate: (candidate: IconSearchCandidate) => void;
  onPickCandidateAndClose: (candidate: IconSearchCandidate) => void;
  working: boolean;
  heading?: string;
  description?: string;
  unmanagedHint?: string;
}

type IconPickerPanelProps = IconPreviewSectionProps | IconSearchSectionProps;

export function IconPickerPanel(props: IconPickerPanelProps) {
  if (props.section === 'preview') {
    const {
      tileShape, previewSrc, fallbackLetter, canManage, onRefresh, onRemove,
      onUploadClick, fileInputRef, onFileChange, hintText, scopeControl, sourceInfo,
    } = props;
    return (
      <>
        <div className="ff-iconpreview" aria-label="Icon preview">
          {previewSrc ? (
            <div
              style={{
                width: '70%',
                height: '70%',
                borderRadius: radiusForShape(tileShape),
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <img
                src={previewSrc}
                alt=""
                referrerPolicy="no-referrer"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          ) : (
            <span className="ff-iconpreview__fallback">
              {fallbackLetter.toUpperCase()}
            </span>
          )}
          {canManage && (
            <div className="ff-iconpreview__hover">
              {onRefresh && (
                <button type="button" onClick={onRefresh} aria-label="Refresh icon" title="Refresh icon">
                  <Ico name="refresh" size={14} />
                  <span>Refresh</span>
                </button>
              )}
              <button type="button" onClick={onRemove} aria-label="Remove icon override" title="Remove icon override">
                <Ico name="trash" size={14} />
                <span>Remove</span>
              </button>
              <button
                type="button"
                onClick={onUploadClick}
                aria-label="Upload icon"
                title="Upload icon"
                style={onRefresh ? { gridColumn: 'span 2' } : undefined}
              >
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
          onChange={onFileChange}
          style={{ display: 'none' }}
        />

        {scopeControl}

        {canManage && (
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: 'var(--fg-3)',
              textAlign: 'center',
              letterSpacing: 0.2,
            }}
          >
            {hintText}
          </p>
        )}

        {sourceInfo}
      </>
    );
  }

  const {
    canManage, query, onQueryChange, onSearchSubmit, searching, results, validatedPreviews,
    onPreviewLoad, onPickCandidate, onPickCandidateAndClose, working, heading, description, unmanagedHint,
  } = props;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h4 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600 }}>
            {heading ?? 'Search icons'}
          </h4>
          {results.length > 0 && (
            <span style={{ fontSize: 12, color: 'var(--fg-3)', flexShrink: 0 }}>
              {results.length} candidate{results.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
          {description ?? 'Search the web for icons and favicons. Click any result to apply instantly.'}
        </p>
      </div>

      {/* Deliberately NOT a <form>. This panel is embedded in FolderNameDialog,
          whose ModalDialog root IS a form — a nested <form> is invalid HTML, and
          the resulting submit escaped React's onSubmit entirely: clicking Search
          did a native GET, reloading newtab.html and destroying the dialog with
          the user's unsaved folder name in it. Enter-to-search is wired on the
          input instead, so the panel is safe to embed anywhere. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="ff-input"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // Stop the keypress reaching an enclosing form, which would submit it.
            e.preventDefault();
            if (!canManage || searching || !query.trim()) return;
            onSearchSubmit();
          }}
          placeholder="Search for an icon"
          style={{ flex: 1 }}
          disabled={!canManage}
        />
        <button
          className="ff-btn ff-btn--ghost"
          type="button"
          onClick={() => onSearchSubmit()}
          disabled={!canManage || searching || !query.trim()}
          title="Search for icons"
        >
          <Ico name="search" size={14} />
          <span>Search</span>
        </button>
      </div>

      {!canManage ? (
        <p style={{ fontSize: 12, color: 'var(--fg-3)', margin: 0 }}>
          {unmanagedHint ?? 'Save the bookmark first to manage its icon.'}
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
                title={`${candidate.label} — ${candidateSourceLabel(candidate)} — double-click to apply and close`}
                onClick={() => onPickCandidate(candidate)}
                onDoubleClick={() => { void onPickCandidateAndClose(candidate); }}
                data-busy={working || undefined}
                style={{ display: isValidated ? undefined : 'none' }}
              >
                <img
                  src={candidate.previewUrl}
                  alt=""
                  referrerPolicy={IS_FIREFOX ? 'origin' : 'no-referrer'}
                  onLoad={(e) => onPreviewLoad(candidate.imageUrl, e.currentTarget)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
