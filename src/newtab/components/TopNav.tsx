import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BookmarkNode, BookmarkSortMode, SortDirection, ViewMode, WorkspaceRecord } from '@/shared/messages';
import { altShortcut } from '../lib/platform';
import { useScrollCollapsed } from '../lib/useScrollCollapsed';
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
  onReorderWorkspaces: (ids: string[]) => void;
  onOpenAddMenu: (x: number, y: number) => void;
  path: BookmarkNode[];
  onCrumb: (index: number) => void;
  sortValue: string;
  onSort: (choice: SortChoice) => void;
  folderMode: ViewMode;
  onToggleViewMode: () => void;
  onOpenAppSettings: () => void;
  onOpenWorkspaceSettings: () => void;
  // When true, a folder tile is being dragged — show a "drop to create workspace"
  // zone on the tab strip so users discover the action.
  folderDragActive?: boolean;
  // Whether the workspace cap is reached (suppresses the drop affordance).
  atWorkspaceCap?: boolean;
}

interface WorkspaceTabsProps {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  onWorkspaceContextMenu: (id: string, x: number, y: number) => void;
  onReorderWorkspaces: (ids: string[]) => void;
  onOverflowChange: (overflow: boolean) => void;
  folderDragActive: boolean;
  atWorkspaceCap: boolean;
}

function WorkspaceTabs({ workspaces, activeWorkspaceId, onSwitchWorkspace, onWorkspaceContextMenu, onReorderWorkspaces, onOverflowChange, folderDragActive, atWorkspaceCap }: WorkspaceTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [dragSrcId, setDragSrcId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    onOverflowChange(el.scrollWidth - el.clientWidth > 4);
  }, [onOverflowChange]);

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

  const commitDrop = (insertAt: number) => {
    if (!dragSrcId) return;
    const ids = workspaces.map(w => w.id);
    const from = ids.indexOf(dragSrcId);
    if (from === -1) return;
    const next = [...ids];
    next.splice(from, 1);
    const adjustedTo = insertAt > from ? insertAt - 1 : insertAt;
    next.splice(adjustedTo, 0, dragSrcId);
    onReorderWorkspaces(next);
  };

  return (
    <div
      className="ff-ws-tabs-wrap"
      data-fade-left={canScrollLeft}
      data-fade-right={canScrollRight}
      data-folder-drag-active={folderDragActive || undefined}
      data-at-workspace-cap={atWorkspaceCap || undefined}
      data-workspace-drop-zone="true"
    >
      {canScrollLeft && (
        <button className="ff-ws-scroll ff-ws-scroll--left" onClick={() => scroll(-1)} aria-label="Scroll tabs left" title="Scroll tabs left">
          <Ico name="chevronLeft" size={16} />
        </button>
      )}
      <div
        className="ff-ws-tabs"
        ref={scrollRef}
        role="tablist"
        onDragLeave={e => { if (!scrollRef.current?.contains(e.relatedTarget as Node)) setDropIndex(null); }}
      >
        {workspaces.map((ws, i) => {
          const shortcut = i < 9 ? altShortcut(String(i + 1)) : null;
          const title = shortcut ? `Switch to ${ws.name} (${shortcut})` : `Switch to ${ws.name}`;
          return (
            <button
              key={ws.id}
              role="tab"
              aria-selected={ws.id === activeWorkspaceId}
              className={`ff-ws-tab${ws.id === activeWorkspaceId ? ' is-active' : ''}`}
              onClick={() => { if (!dragSrcId) onSwitchWorkspace(ws.id); }}
              onContextMenu={e => { e.preventDefault(); onWorkspaceContextMenu(ws.id, e.clientX, e.clientY); }}
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragSrcId(ws.id); }}
              onDragOver={e => {
                e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDropIndex(e.clientX < rect.left + rect.width / 2 ? i : i + 1);
              }}
              onDrop={e => { e.preventDefault(); if (dropIndex !== null) commitDrop(dropIndex); setDropIndex(null); }}
              onDragEnd={() => { setDragSrcId(null); setDropIndex(null); }}
              data-dragging={dragSrcId === ws.id}
              data-drop-before={dropIndex === i && dragSrcId !== null && ws.id !== dragSrcId}
              data-drop-after={dropIndex === i + 1 && i === workspaces.length - 1 && dragSrcId !== null}
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
        <button className="ff-ws-scroll ff-ws-scroll--right" onClick={() => scroll(1)} aria-label="Scroll tabs right" title="Scroll tabs right">
          <Ico name="chevronRight" size={16} />
        </button>
      )}
    </div>
  );
}

function WorkspaceDropdown({ workspaces, activeWorkspaceId, onSwitchWorkspace, overflow }: {
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string;
  onSwitchWorkspace: (id: string) => void;
  overflow: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();

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

  const last = workspaces.length - 1;

  const commitActive = () => {
    const ws = workspaces[activeIndex];
    if (ws) onSwitchWorkspace(ws.id);
    setOpen(false);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setActiveIndex(Math.max(0, workspaces.findIndex(w => w.id === activeWorkspaceId)));
        setOpen(true);
      } else if (last >= 0) {
        setActiveIndex(i => (i >= last ? 0 : i + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setActiveIndex(Math.max(0, workspaces.findIndex(w => w.id === activeWorkspaceId)));
        setOpen(true);
      } else if (last >= 0) {
        setActiveIndex(i => (i <= 0 ? last : i - 1));
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      e.stopPropagation();
      commitActive();
    }
  };

  return (
    <div className="ff-ws-dropdown" ref={ref} data-ws-overflow={overflow ? 'true' : 'false'}>
      <button
        className="ff-pill"
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
        role="combobox"
        aria-controls={open ? `${uid}-listbox` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${workspaces.length} workspaces`}
        aria-activedescendant={open ? `${uid}-${String(activeIndex)}` : undefined}
        title="Jump to workspace"
      >
        <Ico name="chevronDown" size={12} />
        <span className="ff-ws-dropdown__count" aria-hidden="true">{workspaces.length}</span>
      </button>
      {open && (
        <ul id={`${uid}-listbox`} className="ff-sort__panel ff-ws-dropdown__panel" role="listbox">
          {workspaces.map((ws, i) => (
            <li
              key={ws.id}
              id={`${uid}-${String(i)}`}
              role="option"
              aria-selected={ws.id === activeWorkspaceId}
              className="ff-sort__option"
              data-active={ws.id === activeWorkspaceId}
              data-highlighted={i === activeIndex ? 'true' : undefined}
              data-option-workspace-id={ws.id}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => { onSwitchWorkspace(ws.id); setOpen(false); }}
            >
              <span className="ff-ws-tab__dot" style={{ background: ws.accentColor }} />
              <span>{ws.name}</span>
              {i < 9 && <span className="ff-ws-dropdown__hint">{altShortcut(String(i + 1))}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TopNav({ workspaces, activeWorkspaceId, onSwitchWorkspace, onWorkspaceContextMenu, onReorderWorkspaces, onOpenAddMenu, path, onCrumb, sortValue, onSort, folderMode, onToggleViewMode, onOpenAppSettings, onOpenWorkspaceSettings, folderDragActive = false, atWorkspaceCap = false }: TopNavProps) {
  const scrolled = useScrollCollapsed();
  const [sortOpen, setSortOpen] = useState(false);
  const [sortActiveIndex, setSortActiveIndex] = useState(0);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const sortUid = useId();

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
  const sortLast = SORT_OPTIONS.length - 1;

  const commitActiveSort = () => {
    const choice = SORT_OPTIONS[sortActiveIndex];
    if (choice) onSort(choice);
    setSortOpen(false);
  };

  const onSortTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (!sortOpen) {
        setSortActiveIndex(Math.max(0, SORT_OPTIONS.findIndex(o => o.value === sortValue)));
        setSortOpen(true);
      } else {
        setSortActiveIndex(i => (i >= sortLast ? 0 : i + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!sortOpen) {
        setSortActiveIndex(Math.max(0, SORT_OPTIONS.findIndex(o => o.value === sortValue)));
        setSortOpen(true);
      } else {
        setSortActiveIndex(i => (i <= 0 ? sortLast : i - 1));
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && sortOpen) {
      e.preventDefault();
      e.stopPropagation();
      commitActiveSort();
    }
  };

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
              onReorderWorkspaces={onReorderWorkspaces}
              onOverflowChange={setTabsOverflow}
              folderDragActive={folderDragActive}
              atWorkspaceCap={atWorkspaceCap}
            />
            <WorkspaceDropdown
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
              onSwitchWorkspace={onSwitchWorkspace}
              overflow={tabsOverflow}
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
          title="Add"
          aria-haspopup="menu"
          onClick={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); onOpenAddMenu(r.left, r.bottom + 6); }}
        >
          <Ico name="plus" size={16} />
        </button>
        <button
          className="ff-iconbtn ff-iconbtn--icon"
          aria-label={folderMode === 'grid' ? 'Switch to List view' : 'Switch to Grid view'}
          title={folderMode === 'grid' ? 'Switch to List view' : 'Switch to Grid view'}
          onClick={onToggleViewMode}
        >
          <Ico name={folderMode === 'grid' ? 'rows' : 'layoutGrid'} size={16} />
        </button>
        <div className="ff-sort" ref={sortRef}>
          <button
            className="ff-pill"
            aria-label={`Sort bookmarks (current: ${sortLabel})`}
            title="Sort bookmarks"
            role="combobox"
            aria-controls={sortOpen ? `${sortUid}-listbox` : undefined}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            aria-activedescendant={sortOpen ? `${sortUid}-${String(sortActiveIndex)}` : undefined}
            onClick={() => setSortOpen(o => !o)}
            onKeyDown={onSortTriggerKeyDown}
          >
            <Ico name="sort" size={14} />
            <span className="ff-sort__current">{sortLabel}</span>
            <Ico name="chevronDown" size={12} />
          </button>
          {sortOpen && (
            <ul id={`${sortUid}-listbox`} className="ff-sort__panel" role="listbox">
              {SORT_OPTIONS.map((o, i) => (
                <li
                  key={o.value}
                  id={`${sortUid}-${String(i)}`}
                  role="option"
                  aria-selected={o.value === sortValue}
                  className="ff-sort__option"
                  data-active={o.value === sortValue}
                  data-highlighted={i === sortActiveIndex ? 'true' : undefined}
                  onMouseEnter={() => setSortActiveIndex(i)}
                  onClick={() => { onSort(o); setSortOpen(false); }}
                >
                  <span>{o.label}</span>
                  {o.value === sortValue && <Ico name="check" size={14} />}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button className="ff-iconbtn" onClick={onOpenWorkspaceSettings} aria-label="Customize workspace" title="Customize workspace">
          <Ico name="palette" size={16} />
          <span>Customize</span>
        </button>
        <button className="ff-iconbtn" onClick={onOpenAppSettings} aria-label="Settings" title="Settings">
          <Ico name="settings" size={16} />
          <span>Settings</span>
        </button>
      </div>
    </nav>
  );
}
