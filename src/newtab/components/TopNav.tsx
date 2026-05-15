import { useEffect, useRef, useState } from 'react';
import type { BookmarkNode, BookmarkSortMode, SortDirection } from '../../shared/messages';
import { Ico } from './Ico';

export interface SortChoice {
  value: string;
  label: string;
  mode: BookmarkSortMode;
  direction: SortDirection;
}

export const SORT_OPTIONS: SortChoice[] = [
  { value: 'manual',           label: 'Manual',                   mode: 'manual',   direction: 'asc' },
  { value: 'name:asc',         label: 'Name (A → Z)',             mode: 'name',     direction: 'asc' },
  { value: 'name:desc',        label: 'Name (Z → A)',             mode: 'name',     direction: 'desc' },
  { value: 'lastUsed:desc',    label: 'Last used',                mode: 'lastUsed', direction: 'desc' },
  { value: 'created:desc',     label: 'Date added (newest)',      mode: 'created',  direction: 'desc' },
  { value: 'created:asc',      label: 'Date added (oldest)',      mode: 'created',  direction: 'asc' },
];

interface TopNavProps {
  path: BookmarkNode[];
  onCrumb: (index: number) => void;
  sortValue: string;
  onSort: (choice: SortChoice) => void;
  onOpenSettings: () => void;
  onAddBookmark: () => void;
}

export function TopNav({ path, onCrumb, sortValue, onSort, onOpenSettings, onAddBookmark }: TopNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!sortOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) setSortOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSortOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [sortOpen]);

  const atRoot = path.length === 0;
  const sortLabel = SORT_OPTIONS.find(o => o.value === sortValue)?.label ?? 'Manual';

  return (
    <nav className={`ff-nav ${scrolled ? 'is-scrolled' : ''}`} aria-label="Workspace">
      <div className="ff-nav__left">
        <button className="ff-iconbtn" aria-label="Home" onClick={() => onCrumb(0)}>
          <Ico name="home" size={16} />
          <span>Home</span>
        </button>
      </div>
      <div className="ff-nav__center">
        <div className="ff-crumb">
          {atRoot ? (
            <span className="ff-crumb__here">My bookmarks</span>
          ) : (
            <>
              <button className="ff-crumb__btn" onClick={() => onCrumb(0)}>My bookmarks</button>
              {path.map((f, i) => (
                <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Ico name="chevronRight" size={11} className="ff-crumb__sep" />
                  {i === path.length - 1 ? (
                    <span className="ff-crumb__here">{f.title}</span>
                  ) : (
                    <button className="ff-crumb__btn" onClick={() => onCrumb(i + 1)}>{f.title}</button>
                  )}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
      <div className="ff-nav__right">
        <div className="ff-sort" ref={sortRef}>
          <button
            className="ff-pill"
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            onClick={() => setSortOpen(o => !o)}
          >
            <Ico name="sort" size={14} />
            <span>{sortLabel}</span>
            <Ico name="chevronDown" size={12} />
          </button>
          {sortOpen && (
            <ul className="ff-sort__panel" role="listbox">
              {SORT_OPTIONS.map(o => (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={o.value === sortValue}
                  className="ff-sort__option"
                  data-active={o.value === sortValue}
                  onClick={() => { onSort(o); setSortOpen(false); }}
                >
                  <span>{o.label}</span>
                  {o.value === sortValue && <Ico name="check" size={14} />}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Add bookmark" onClick={onAddBookmark}>
          <Ico name="plus" size={16} />
        </button>
        <button className="ff-iconbtn" onClick={onOpenSettings} aria-label="Settings">
          <Ico name="settings" size={16} />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}
