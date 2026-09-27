import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { TileShape, ViewMode } from '@/shared/messages';
import {
  CUSTOM_LAYOUT_PRESET,
  CustomLayoutPreview,
  DensityPreview,
  GridViewPreview,
  LAYOUT_PRESETS,
  ListViewPreview,
  SectionTitle,
  Slider,
  TileShapePreview,
  Toggle,
} from '../settings-controls';
import { Ico } from '../Ico';
import { SORT_OPTIONS, type SortChoice } from '../TopNav';
import { FALLBACK_WORKSPACE } from './types';
import type { WorkspaceSectionProps } from './types';

function sortValueFor(mode: string, direction: string): string {
  return mode === 'manual' ? 'manual' : `${mode}:${direction}`;
}

interface SortDropdownProps {
  value: string;
  onSelect: (choice: SortChoice) => void;
}

function SortDropdown({ value, onSelect }: SortDropdownProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const uid = useId();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = SORT_OPTIONS.find(o => o.value === value)?.label ?? 'Manual';
  const last = SORT_OPTIONS.length - 1;

  const commitActive = () => {
    const choice = SORT_OPTIONS[activeIndex];
    if (choice) onSelect(choice);
    setOpen(false);
  };

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setActiveIndex(Math.max(0, SORT_OPTIONS.findIndex(o => o.value === value)));
        setOpen(true);
      } else {
        setActiveIndex(i => (i >= last ? 0 : i + 1));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!open) {
        setActiveIndex(Math.max(0, SORT_OPTIONS.findIndex(o => o.value === value)));
        setOpen(true);
      } else {
        setActiveIndex(i => (i <= 0 ? last : i - 1));
      }
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      e.stopPropagation();
      commitActive();
    }
  };

  return (
    <div className="ff-sort ff-sort--block" ref={ref}>
      <button
        type="button"
        className="ff-pill ff-sort__trigger"
        role="combobox"
        aria-controls={open ? `${uid}-listbox` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Sort bookmarks (current: ${label})`}
        aria-activedescendant={open ? `${uid}-${String(activeIndex)}` : undefined}
        title="Sort bookmarks"
        onClick={() => setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
      >
        <Ico name="sort" size={14} />
        <span className="ff-sort__current">{label}</span>
        <Ico name="chevronDown" size={12} />
      </button>
      {open && (
        <ul id={`${uid}-listbox`} className="ff-sort__panel" role="listbox">
          {SORT_OPTIONS.map((o, i) => (
            <li
              key={o.value}
              id={`${uid}-${String(i)}`}
              role="option"
              aria-selected={o.value === value}
              className="ff-sort__option"
              data-active={o.value === value}
              data-highlighted={i === activeIndex ? 'true' : undefined}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => { onSelect(o); setOpen(false); }}
            >
              <span>{o.label}</span>
              {o.value === value && <Ico name="check" size={14} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LayoutSection({ workspace, onPatch }: WorkspaceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const isCustom = ws.layoutPreset === 'custom';
  const sortValue = sortValueFor(ws.bookmarkSortMode, ws.bookmarkSortDirection);
  const iconSizeLabelId = useId();
  const tileWidthLabelId = useId();
  const columnGapLabelId = useId();
  const rowGapLabelId = useId();
  const showTileLabelsId = useId();
  return (
    <div className="ff-set-section">
      <SectionTitle>Sort</SectionTitle>
      <div style={{ marginBottom: 4 }}>
        <SortDropdown
          value={sortValue}
          onSelect={(choice) => onPatch({ bookmarkSortMode: choice.mode, bookmarkSortDirection: choice.direction })}
        />
      </div>
      <SectionTitle>View</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 4 }}>
        {([
          { mode: 'grid' as ViewMode, label: 'Grid', desc: 'Folder tiles' },
          { mode: 'list' as ViewMode, label: 'List', desc: 'Open inline' },
        ]).map(({ mode, label, desc }) => {
          const activeView = ws.folderMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => onPatch({ folderMode: mode })}
              className="ff-card"
              data-active={activeView}
              aria-pressed={activeView}
              style={{
                textAlign: 'left', cursor: 'pointer', color: 'var(--fg-1)', font: 'inherit',
                borderColor: activeView ? 'var(--accent)' : 'var(--line-1)',
                background: activeView ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{desc}</span>
              </div>
              {mode === 'grid' ? <GridViewPreview active={activeView} /> : <ListViewPreview active={activeView} />}
            </button>
          );
        })}
      </div>
      <SectionTitle>Density</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 4 }}>
        {LAYOUT_PRESETS.map(p => {
          const active = ws.layoutPreset === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onPatch({ layoutPreset: p.id })}
              className="ff-card"
              style={{
                textAlign: 'left', cursor: 'pointer', color: 'var(--fg-1)', font: 'inherit',
                borderColor: active ? 'var(--accent)' : 'var(--line-1)',
                background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 600 }}>{p.label}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.desc}</span>
              </div>
              <DensityPreview cols={p.cols} active={active} />
            </button>
          );
        })}
        <button
          key={CUSTOM_LAYOUT_PRESET.id}
          onClick={() => onPatch({ layoutPreset: 'custom' })}
          className="ff-card"
          style={{
            gridColumn: 'span 2',
            textAlign: 'left', cursor: 'pointer', color: 'var(--fg-1)', font: 'inherit',
            borderColor: isCustom ? 'var(--accent)' : 'var(--line-1)',
            background: isCustom ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 600 }}>{CUSTOM_LAYOUT_PRESET.label}</span>
            <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{CUSTOM_LAYOUT_PRESET.desc}</span>
          </div>
          <CustomLayoutPreview active={isCustom} />
        </button>
      </div>
      {isCustom && (
        <div className="ff-card" style={{ marginBottom: 16 }}>
          <div className="ff-row">
            <div>
              <div className="ff-row__label" id={iconSizeLabelId}>Icon size</div>
              <div className="ff-row__hint">How big each tile icon renders.</div>
            </div>
            <Slider
              labelledBy={iconSizeLabelId}
              value={ws.bookmarkIconSize}
              min={40}
              max={112}
              onChange={(v) => onPatch({ bookmarkIconSize: v })}
              onPreview={(v) => document.documentElement.style.setProperty('--tile-size', `${String(v)}px`)}
              formatValue={(v) => `${String(v)}px`}
            />
          </div>
          <div className="ff-row">
            <div>
              <div className="ff-row__label" id={tileWidthLabelId}>Tile width</div>
              <div className="ff-row__hint">Cell width — affects label wrapping and column count.</div>
            </div>
            <Slider
              labelledBy={tileWidthLabelId}
              value={ws.bookmarkTileWidth}
              min={88}
              max={180}
              onChange={(v) => onPatch({ bookmarkTileWidth: v })}
              onPreview={(v) => document.documentElement.style.setProperty('--tile-width', `${String(v)}px`)}
              formatValue={(v) => `${String(v)}px`}
            />
          </div>
          <div className="ff-row">
            <div>
              <div className="ff-row__label" id={columnGapLabelId}>Column gap</div>
              <div className="ff-row__hint">Horizontal space between tiles.</div>
            </div>
            <Slider
              labelledBy={columnGapLabelId}
              value={ws.favoritesColumnGap}
              min={0}
              max={48}
              onChange={(v) => onPatch({ favoritesColumnGap: v })}
              onPreview={(v) => document.documentElement.style.setProperty('--grid-gap-x', `${String(v)}px`)}
              formatValue={(v) => `${String(v)}px`}
            />
          </div>
          <div className="ff-row">
            <div>
              <div className="ff-row__label" id={rowGapLabelId}>Row gap</div>
              <div className="ff-row__hint">Vertical space between tiles.</div>
            </div>
            <Slider
              labelledBy={rowGapLabelId}
              value={ws.favoritesRowGap}
              min={0}
              max={48}
              onChange={(v) => onPatch({ favoritesRowGap: v })}
              onPreview={(v) => document.documentElement.style.setProperty('--grid-gap-y', `${String(v)}px`)}
              formatValue={(v) => `${String(v)}px`}
            />
          </div>
        </div>
      )}
      <SectionTitle>Tile shape</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {([
          { id: 'squircle' as TileShape, label: 'Squircle' },
          { id: 'rounded' as TileShape, label: 'Rounded' },
          { id: 'circle' as TileShape, label: 'Circle' },
        ]).map(({ id, label }) => {
          const activeShape = ws.tileShape === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPatch({ tileShape: id })}
              className="ff-card"
              data-active={activeShape}
              aria-pressed={activeShape}
              style={{
                textAlign: 'left', cursor: 'pointer', color: 'var(--fg-1)', font: 'inherit',
                borderColor: activeShape ? 'var(--accent)' : 'var(--line-1)',
                background: activeShape ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{label}</div>
              <TileShapePreview shape={id} active={activeShape} />
            </button>
          );
        })}
      </div>
      <div className="ff-card" style={{ marginTop: 16 }}>
        <div className="ff-row">
          <div className="ff-row__label" id={showTileLabelsId}>Show tile labels</div>
          <Toggle labelledBy={showTileLabelsId} on={ws.showTileLabels} onChange={(v) => onPatch({ showTileLabels: v })} />
        </div>
      </div>
    </div>
  );
}
