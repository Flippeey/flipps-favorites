import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookmarkNode, BookmarkSortMode, SortDirection, WorkspaceRecord } from '../../shared/messages';
import { altShortcut } from '../lib/platform';
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
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onWorkspaceContextMenu: (id: string, x: number, y: number) => void;
  onOpenAddMenu: (x: number, y: number) => void;
  path: BookmarkNode[];
  onCrumb: (index: number) => void;
  sortValue: string;
  onSort: (choice: SortChoice) => void;
  onOpenSettings: () => void;
}

interface WorkspaceTabsProps {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onWorkspaceContextMenu: (id: string, x: number, y: number) => void;
}

function WorkspaceTabs({ workspaces, activeWorkspaceId, onSwitchWorkspace, onWorkspaceContextMenu }: WorkspaceTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    el.addEventListener('scroll', updateArrows, { passive: true });
    updateArrows();
    return () => { ro.disconnect(); el.removeEventListener('scroll', updateArrows); };
  }, [updateArrows]);

  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLElement>('.is-active');
    el?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' });
  }, [activeWorkspaceId]);

  const scroll = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * 120, behavior: 'smooth' });
  };

  return (
    <div className="ff-ws-tabs-wrap">
      {canScrollLeft && (
        <button className="ff-ws-scroll ff-ws-scroll--left" onClick={() => scroll(-1)} aria-label="Scroll tabs left">
          <Ico name="chevronLeft" size={12} />
        </button>
      )}
      <div className="ff-ws-tabs" ref={scrollRef} role="tablist">
        {workspaces.map((ws, i) => {
          const shortcut = i < 9 ? altShortcut(String(i + 1)) : null;
          const title = shortcut ? `Switch to ${ws.name} (${shortcut})` : `Switch to ${ws.name}`;
          return (
            <button
              key={ws.id}
              role="tab"
              aria-selected={ws.id === activeWorkspaceId}
              className={`ff-ws-tab${ws.id === activeWorkspaceId ? ' is-active' : ''}`}
              onClick={() => onSwitchWorkspace(ws.id)}
              onContextMenu={e => { e.preventDefault(); onWorkspaceContextMenu(ws.id, e.clientX, e.clientY); }}
              data-drop-target="workspace"
              data-workspace-id={ws.id}
              title={title}
            >
              <span className="ff-ws-tab__dot" style={{ background: ws.accentColor }} />
              <span className="ff-ws-tab__name">{ws.name}</span>
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <button className="ff-ws-scroll ff-ws-scroll--right" onClick={() => scroll(1)} aria-label="Scroll tabs right">
          <Ico name="chevronRight" size={12} />
        </button>
      )}
    </div>
  );
}

function WorkspaceDropdown({ workspaces, activeWorkspaceId, onSwitchWorkspace }: {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ff-ws-dropdown" ref={ref}>
      <button className="ff-pill" onClick={() => setOpen(o => !o)} aria-haspopup="listbox" aria-expanded={open}>
        {activeWs && <span className="ff-ws-tab__dot" style={{ background: activeWs.accentColor }} />}
        <span>{activeWs?.name ?? 'Workspace'}</span>
        <Ico name="chevronDown" size={12} />
      </button>
      {open && (
        <ul className="ff-sort__panel" role="listbox">
          {workspaces.map((ws, i) => (
            <li
              key={ws.id}
              role="option"
              aria-selected={ws.id === activeWorkspaceId}
              className="ff-sort__option"
              data-active={ws.id === activeWorkspaceId}
              onClick={() => { onSwitchWorkspace(ws.id); setOpen(false); }}
            >
              <span className="ff-ws-tab__dot" style={{ background: ws.accentColor }} />
              <span>{ws.name}</span>
              {i < 9 && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--fg-4)' }}>{altShortcut(String(i + 1))}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopNav({ workspaces, activeWorkspaceId, onSwitchWorkspace, onWorkspaceContextMenu, onOpenAddMenu, path, onCrumb, sortValue, onSort, onOpenSettings }: TopNavProps) {
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

  const sortLabel = SORT_OPTIONS.find(o => o.value === sortValue)?.label ?? 'Manual';

  return (
    <nav className={`ff-nav ${scrolled ? 'is-scrolled' : ''}`} aria-label="Workspace">
      <div className="ff-nav__left" aria-hidden="true" />
      <div className="ff-nav__center">
        {path.length === 0 ? (
          <>
            <WorkspaceTabs
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSwitchWorkspace={onSwitchWorkspace}
              onWorkspaceContextMenu={onWorkspaceContextMenu}
            />
            <WorkspaceDropdown
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSwitchWorkspace={onSwitchWorkspace}
            />
          </>
        ) : (
          <div className="ff-crumb">
            <button className="ff-crumb__btn" onClick={() => onSwitchWorkspace(activeWorkspaceId)}>
              {workspaces.find(w => w.id === activeWorkspaceId)?.name ?? ''}
            </button>
            {path.map((f, i) => (
              <span key={f.id} className="ff-crumb-segment">
                <Ico name="chevronRight" size={11} className="ff-crumb__sep" />
                {i === path.length - 1 ? (
                  <span className="ff-crumb__here">{f.title}</span>
                ) : (
                  <button className="ff-crumb__btn" onClick={() => onCrumb(i + 1)}>{f.title}</button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="ff-nav__right">
        <button
          className="ff-iconbtn ff-iconbtn--icon"
          aria-label="Add"
          aria-haspopup="menu"
          onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onOpenAddMenu(r.left, r.bottom + 6); }}
        >
          <Ico name="plus" size={16} />
        </button>
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
        <button className="ff-iconbtn" onClick={onOpenSettings} aria-label="Settings">
          <Ico name="settings" size={16} />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}
