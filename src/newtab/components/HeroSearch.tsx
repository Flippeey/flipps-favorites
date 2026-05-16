import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BookmarkNode, ClockHourFormat, TileShape } from '../../shared/messages';
import { Favicon } from './Favicon';
import { Ico } from './Ico';

export interface FlatSearchResult {
  id: string;
  title: string;
  url?: string;
  isFolder?: boolean;
  folderTitle?: string;
  folderId?: string;
}

export function buildSearchIndex(tree: BookmarkNode[]): FlatSearchResult[] {
  const out: FlatSearchResult[] = [];
  const walk = (nodes: BookmarkNode[], parent?: BookmarkNode) => {
    for (const n of nodes) {
      if (Array.isArray(n.children)) {
        out.push({ id: n.id, title: n.title, isFolder: true });
        walk(n.children, n);
      } else {
        out.push({
          id: n.id,
          title: n.title,
          url: n.url,
          folderId: parent?.id,
          folderTitle: parent?.title,
        });
      }
    }
  };
  walk(tree);
  return out;
}

interface HeroSearchProps {
  shape: TileShape;
  index: FlatSearchResult[];
  onPickBookmark: (item: FlatSearchResult) => void;
  onPickFolder: (item: FlatSearchResult) => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export function HeroSearch({ shape, index, onPickBookmark, onPickFolder }: HeroSearchProps) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const focusInput = () => inputRef.current?.focus({ preventScroll: true });
    focusInput();
    const raf = requestAnimationFrame(focusInput);
    const t1 = window.setTimeout(focusInput, 50);
    const t2 = window.setTimeout(focusInput, 200);
    const onVis = () => { if (document.visibilityState === 'visible') focusInput(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', focusInput);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', focusInput);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      // `/` as a fallback shortcut — common pattern (GitHub etc.) and not browser-reserved.
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const results = useMemo(() => {
    if (!value) return [];
    const q = value.toLowerCase();
    return index.filter(item =>
      item.title.toLowerCase().includes(q) ||
      (item.url && item.url.toLowerCase().includes(q))
    );
  }, [value, index]);

  const bookmarks = results.filter(r => !r.isFolder);
  const folders = results.filter(r => r.isFolder);

  const visible = useMemo(
    () => [...bookmarks.slice(0, 6), ...folders.slice(0, 3)],
    [bookmarks, folders],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [value]);

  useLayoutEffect(() => {
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const openAt = (i: number) => {
    const r = visible[i];
    if (!r) return;
    setValue('');
    if (r.isFolder) onPickFolder(r);
    else onPickBookmark(r);
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (visible.length === 0) return;
    const last = visible.length - 1;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setActiveIndex(i => (i >= last ? 0 : i + 1));
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setActiveIndex(i => (i <= 0 ? last : i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openAt(activeIndex);
    }
  };

  return (
    <>
      <label className="ff-search">
        <span className="ff-search__icon"><Ico name="search" size={18} /></span>
        <input
          ref={inputRef}
          type="text"
          placeholder="Search bookmarks or type a URL"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onInputKeyDown}
          aria-label="Search bookmarks"
          aria-autocomplete="list"
          aria-controls="ff-search-results"
          aria-activedescendant={visible.length > 0 ? `ff-search-opt-${activeIndex}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />
        {value && (
          <button
            type="button"
            className="ff-search__clear"
            aria-label="Clear search"
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
          {visible.length === 0 && (
            <div style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--fg-3)', fontSize: 13 }}>
              No matches.
            </div>
          )}
          {visible.map((r, i) => {
            const prev = visible[i - 1];
            const showBookmarksHeader = i === 0 && !r.isFolder;
            const showFoldersHeader = r.isFolder && (i === 0 || !prev?.isFolder);
            return (
              <div key={r.id}>
                {showBookmarksHeader && <div className="ff-results__group">Bookmarks</div>}
                {showFoldersHeader && <div className="ff-results__group">Folders</div>}
                <div
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
                      }}>
                        <Ico name="folder" size={16} />
                      </div>
                      <span className="ff-results__title">{r.title}</span>
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
                      <span className="ff-results__path">{r.folderTitle}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
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
