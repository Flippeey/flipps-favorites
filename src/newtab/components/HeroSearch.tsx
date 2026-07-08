import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkNode, ClockHourFormat, TileShape, WorkspaceRecord } from '@/shared/messages';
import { IS_MAC } from '../lib/platform';
import { classifyHeroInput } from '../lib/url';
import { Favicon } from './Favicon';
import { Ico } from './Ico';

export interface FlatSearchResult {
  id: string;
  title: string;
  url?: string;
  isFolder?: boolean;
  folderTitle?: string;
  folderId?: string;
  workspaceId?: string;
  workspaceName?: string;
}

interface WorkspaceTag {
  id: string;
  name: string;
}

// Flatten the tree into a search index. Each node is tagged with the workspace
// that owns it (the workspace whose root folder is an ancestor), so results can
// show which workspace a hit lives in. The workspace root folders themselves are
// excluded — they are containers, not navigable results.
export function buildSearchIndex(tree: BookmarkNode[], workspaces: WorkspaceRecord[] = []): FlatSearchResult[] {
  const rootToWorkspace = new Map<string, WorkspaceTag>();
  for (const ws of workspaces) rootToWorkspace.set(ws.rootFolderId, { id: ws.id, name: ws.name });

  const out: FlatSearchResult[] = [];
  const walk = (nodes: BookmarkNode[], parent: BookmarkNode | undefined, ws: WorkspaceTag | undefined) => {
    for (const n of nodes) {
      const enteredWs = rootToWorkspace.get(n.id);
      const ownerWs = enteredWs ?? ws;
      if (Array.isArray(n.children)) {
        // Skip the workspace root folder node itself (it's the container).
        if (!enteredWs) {
          out.push({ id: n.id, title: n.title, isFolder: true, workspaceId: ws?.id, workspaceName: ws?.name });
        }
        walk(n.children, n, ownerWs);
      } else {
        out.push({
          id: n.id,
          title: n.title,
          url: n.url,
          folderId: parent?.id,
          folderTitle: parent?.title,
          workspaceId: ownerWs?.id,
          workspaceName: ownerWs?.name,
        });
      }
    }
  };
  walk(tree, undefined, undefined);
  return out;
}

interface HeroSearchProps {
  shape: TileShape;
  index: FlatSearchResult[];
  usage?: Record<string, number>;
  activeWorkspaceId?: string;
  onPickBookmark: (item: FlatSearchResult) => void;
  onPickFolder: (item: FlatSearchResult) => void;
  onOpenUrl: (url: string) => void;
  onWebSearch: (query: string) => void;
  overlayMode?: boolean;
}

// Tag to show only when a result lives in a workspace other than the active one.
function foreignWorkspaceTag(r: FlatSearchResult, activeWorkspaceId?: string): string | null {
  if (!r.workspaceName || !r.workspaceId) return null;
  return r.workspaceId === activeWorkspaceId ? null : r.workspaceName;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

const SCORE_TITLE_EXACT = 1000;
const SCORE_TITLE_STARTS = 500;
const SCORE_TITLE_TOKEN_EQ = 600;
const SCORE_TITLE_TOKEN_STARTS = 300;
const SCORE_TITLE_CONTAINS = 150;
const SCORE_HOST_EXACT = 800;
const SCORE_HOST_STARTS = 400;
const SCORE_HOST_SEG_EQ = 500;
const SCORE_HOST_SEG_STARTS = 350;
const SCORE_URL_CONTAINS = 60;
const SCORE_FOLDER_EXACT_BONUS = 200;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_MAX_BOOST = 50;

function getHostname(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`https://${url}`).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}

function tokenizeTitle(title: string): string[] {
  return title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function recencyBoost(lastUsedAt: number | undefined): number {
  if (!lastUsedAt) return 0;
  const age = Date.now() - lastUsedAt;
  if (age <= 0) return RECENCY_MAX_BOOST;
  if (age >= RECENCY_WINDOW_MS) return 0;
  return Math.round(RECENCY_MAX_BOOST * (1 - age / RECENCY_WINDOW_MS));
}

function scoreResult(result: FlatSearchResult, query: string, usage: Record<string, number>): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const title = result.title.toLowerCase();
  const url = (result.url ?? '').toLowerCase();
  const hostname = getHostname(result.url);
  const segments = hostname.split('.').filter(Boolean);
  const tokens = tokenizeTitle(result.title);

  let score = 0;

  if (title === q) {
    score += SCORE_TITLE_EXACT;
  } else if (title.startsWith(q)) {
    score += SCORE_TITLE_STARTS;
  } else {
    let tokenHit = 0;
    for (const tok of tokens) {
      if (tok === q) { tokenHit = SCORE_TITLE_TOKEN_EQ; break; }
      if (tok.startsWith(q) && tokenHit < SCORE_TITLE_TOKEN_STARTS) tokenHit = SCORE_TITLE_TOKEN_STARTS;
    }
    if (tokenHit > 0) score += tokenHit;
    else if (title.includes(q)) score += SCORE_TITLE_CONTAINS;
  }

  if (hostname) {
    const noWww = hostname.replace(/^www\./, '');
    if (hostname === q || noWww === q) {
      score += SCORE_HOST_EXACT;
    } else if (hostname.startsWith(q) || noWww.startsWith(q)) {
      score += SCORE_HOST_STARTS;
    } else {
      let segHit = 0;
      for (const seg of segments) {
        if (seg === q) { segHit = SCORE_HOST_SEG_EQ; break; }
        if (seg.startsWith(q) && segHit < SCORE_HOST_SEG_STARTS) segHit = SCORE_HOST_SEG_STARTS;
      }
      if (segHit > 0) score += segHit;
    }
  }

  if (score === 0 && url.includes(q)) {
    score += SCORE_URL_CONTAINS;
  }

  if (result.isFolder && title === q) {
    score += SCORE_FOLDER_EXACT_BONUS;
  }

  if (score > 0) {
    score += recencyBoost(usage[result.id]);
  }

  return score;
}

export function HeroSearch({ shape, index, usage, activeWorkspaceId, onPickBookmark, onPickFolder, onOpenUrl, onWebSearch, overlayMode }: HeroSearchProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!overlayOpen) setValue('');
  }, [overlayOpen]);

  useEffect(() => {
    if (overlayMode && overlayOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [overlayMode, overlayOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCtrlK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
      const isSlash = e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey;
      const isBareS = e.key.toLowerCase() === 's' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      if (isCtrlK || ((isSlash || isBareS) && !isTypingTarget(e.target))) {
        e.preventDefault();
        if (overlayMode) setOverlayOpen(true);
        else inputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape' && overlayMode && overlayOpen) {
        setOverlayOpen(false);
        return;
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setValue('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayMode, overlayOpen]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (wrapRef.current?.contains(target)) return;
      setFocused(false);
      if (document.activeElement === inputRef.current) inputRef.current?.blur();
      if (overlayMode) setOverlayOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [overlayMode]);

  const visible = useMemo<FlatSearchResult[]>(() => {
    const q = value.trim();
    if (!q) return [];
    const usageMap = usage ?? {};
    const scored = index
      .map(item => ({ item, score: scoreResult(item, q, usageMap) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    return scored.map(entry => entry.item);
  }, [value, index, usage]);

  useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  useLayoutEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // Zero-match fallback: classify the raw input as an explicit URL to open or
  // a search query to run. Only ever computed (and rendered) when there are
  // no bookmark matches and the trimmed input is non-empty — a whitespace-only
  // query must show no fallback row and never fire a web search.
  const fallback = useMemo(() => {
    if (visible.length > 0 || value.trim().length === 0) return null;
    return classifyHeroInput(value);
  }, [visible.length, value]);

  const openAt = (i: number) => {
    const r = visible[i];
    if (!r) return;
    setValue('');
    if (overlayMode) setOverlayOpen(false);
    if (r.isFolder) onPickFolder(r);
    else onPickBookmark(r);
  };

  const openFallback = () => {
    if (!fallback) return;
    setValue('');
    if (overlayMode) setOverlayOpen(false);
    if (fallback.kind === 'url') {
      onOpenUrl(fallback.url);
    } else {
      const q = fallback.query.trim();
      if (q.length > 0) onWebSearch(q);
    }
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const rowCount = visible.length > 0 ? visible.length : (fallback ? 1 : 0);
    if (rowCount === 0) return;
    const last = rowCount - 1;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setActiveIndex(i => (i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? last : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (visible.length > 0) openAt(activeIndex);
      else openFallback();
    }
  };

  const searchContent = (
    <div className="ff-search-wrap" ref={wrapRef}>
      <label className="ff-search">
        <span className="ff-search__icon"><Ico name="search" size={18} /></span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search any bookmark or folder..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onInputKeyDown}
          aria-label="Search bookmarks"
          aria-autocomplete="list"
          aria-controls="ff-search-results"
          aria-activedescendant={(visible.length > 0 || fallback) ? `ff-search-opt-${activeIndex}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            className="ff-search__clear"
            aria-label="Clear search"
            title="Clear search"
            onMouseDown={(e) => {
              e.preventDefault();
              setValue('');
              inputRef.current?.focus();
            }}
          >
            <Ico name="close" size={14} />
          </button>
        )}
        <span className="ff-kbd">{IS_MAC ? '⌘K' : 'Ctrl K'}</span>
      </label>
      {focused && value && (
        <div
          id="ff-search-results"
          className="ff-results no-scrollbar"
          style={{ overflowY: 'auto' }}
          role="listbox"
        >
          {visible.length === 0 && fallback && (
            <div
              ref={el => { rowRefs.current[0] = el; }}
              id="ff-search-opt-0"
              className="ff-search-fallback"
              data-active={activeIndex === 0}
              data-fallback-kind={fallback.kind}
              role="option"
              aria-selected={activeIndex === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', cursor: 'pointer',
                background: activeIndex === 0 ? 'var(--accent-soft)' : undefined,
              }}
              onMouseEnter={() => setActiveIndex(0)}
              onMouseDown={() => openFallback()}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 6,
                background: 'color-mix(in oklab, var(--accent) 12%, var(--ink-2))',
                display: 'grid', placeItems: 'center', color: 'var(--accent)',
                flex: '0 0 28px',
              }}>
                <Ico name={fallback.kind === 'url' ? 'externalLink' : 'search'} size={16} />
              </div>
              <span className="ff-results__title">
                {fallback.kind === 'url' ? `Open ${fallback.url}` : `Search the web for "${fallback.query.trim()}"`}
              </span>
            </div>
          )}
          {visible.length === 0 && !fallback && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
              No matches.
            </div>
          )}
          {visible.map((r, i) => {
            const wsTag = foreignWorkspaceTag(r, activeWorkspaceId);
            return (
            <div
              key={r.id}
              ref={el => { rowRefs.current[i] = el; }}
              id={`ff-search-opt-${i}`}
              className="ff-results__item"
              data-active={i === activeIndex}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={() => openAt(i)}
            >
              {r.isFolder ? (
                <>
                  <div style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: 'color-mix(in oklab, var(--accent) 12%, var(--ink-2))',
                    display: 'grid', placeItems: 'center', color: 'var(--accent)',
                    flex: '0 0 28px',
                  }}>
                    <Ico name="folder" size={16} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="ff-results__title">{r.title}</span>
                    <span className="ff-results__url" style={{ color: 'var(--fg-3)', fontSize: 11 }}>
                      Folder{wsTag ? ` · ${wsTag}` : ''}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ width: 28, height: 28, flex: '0 0 28px' }}>
                    <Favicon url={r.url} title={r.title} shape={shape} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="ff-results__title">{r.title}</span>
                    <span className="ff-results__url">{r.url}</span>
                  </div>
                  <span className="ff-results__path">
                    {wsTag ? (r.folderTitle ? `${r.folderTitle} · ${wsTag}` : wsTag) : r.folderTitle}
                  </span>
                </>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (overlayMode) {
    if (!overlayOpen) return null;
    return (
      <div className="ff-search-modal" role="dialog" aria-modal="true" aria-label="Search">
        {searchContent}
      </div>
    );
  }
  return searchContent;
}

interface ClockGreetingProps {
  hourFormat: ClockHourFormat;
}

export function ClockGreeting({ hourFormat }: ClockGreetingProps) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const formatter = hourFormat === '12'
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const time = formatter.format(now);
  const date = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="ff-hero__clock">
      <div className="ff-hero__clock-time">{time}</div>
      <div className="ff-hero__clock-date">{date}</div>
    </div>
  );
}

interface ClockMiniProps {
  hourFormat: ClockHourFormat;
}

export function ClockMini({ hourFormat }: ClockMiniProps) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const formatter = hourFormat === '12'
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
    : new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <div className="ff-clock-mini" aria-hidden="true">
      {formatter.format(now)}
    </div>
  );
}
