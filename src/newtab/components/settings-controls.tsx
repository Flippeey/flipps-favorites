import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { BookmarkNode, LayoutPresetId, TileShape } from '@/shared/messages';
import { Ico } from './Ico';

// Reusable section header for the settings drawer. One style for every group
// header across all tabs (Appearance, Layout) — small, quiet, consistent.
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="ff-set-grouptitle">{children}</h3>;
}

export const ACCENT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'blue',     label: 'Blue',     value: '#3F72DC' },
  { id: 'teal',     label: 'Teal',     value: '#23867B' },
  { id: 'green',    label: 'Green',    value: '#2F8F4E' },
  { id: 'lime',     label: 'Lime',     value: '#7BAE2C' },
  { id: 'yellow',   label: 'Yellow',   value: '#C9A227' },
  { id: 'orange',   label: 'Orange',   value: '#F57C00' },
  { id: 'red',      label: 'Red',      value: '#C75252' },
  { id: 'rose',     label: 'Rose',     value: '#C96A7D' },
  { id: 'pink',     label: 'Pink',     value: '#C85FA4' },
  { id: 'purple',   label: 'Purple',   value: '#7D60D8' },
  { id: 'slate',    label: 'Slate',    value: '#778292' },
  { id: 'graphite', label: 'Graphite', value: '#4B5360' },
];

export const LAYOUT_PRESETS: { id: LayoutPresetId; label: string; desc: string; cols: number }[] = [
  { id: 'compact',      label: 'Compact',      desc: 'Dense',    cols: 12 },
  { id: 'balanced',     label: 'Balanced',     desc: 'Default',  cols: 10 },
  { id: 'spacious',     label: 'Spacious',     desc: 'Roomy',    cols: 8 },
  { id: 'presentation', label: 'Presentation', desc: 'Large',    cols: 6 },
];

export const CUSTOM_LAYOUT_PRESET: { id: LayoutPresetId; label: string; desc: string } = {
  id: 'custom', label: 'Custom', desc: 'Fine-tune',
};

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="ff-toggle"
      data-on={on}
      onClick={() => onChange(!on)}
    >
      <span className="ff-toggle__thumb" />
    </button>
  );
}

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: string;
}

export function Segmented<T extends string>({ options, value, onChange }: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="ff-segmented">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          className="ff-segmented__option"
          data-active={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.icon && <Ico name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

interface FolderPickerProps {
  tree: BookmarkNode[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
}

export function FolderPicker({ tree, value, onChange, placeholder = 'Select folder…' }: FolderPickerProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const flat: { id: string; title: string; depth: number }[] = [];
  const walk = (nodes: BookmarkNode[], depth: number) => {
    for (const n of nodes) {
      if (Array.isArray(n.children)) {
        flat.push({ id: n.id, title: n.title, depth });
        walk(n.children, depth + 1);
      }
    }
  };
  walk(tree, 0);

  const current = flat.find(f => f.id === value);

  return (
    <div ref={rootRef} className="ff-fpicker">
      <button
        type="button"
        className="ff-pill"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Ico name="folder" size={12} />
        <span>{current ? current.title : placeholder}</span>
        <Ico name="chevronDown" size={12} />
      </button>
      {open && (
        <ul className="ff-fpicker__panel" role="listbox">
          {flat.length === 0 && <li className="ff-fpicker__empty">No folders</li>}
          {flat.map(f => (
            <li
              key={f.id}
              role="option"
              aria-selected={f.id === value}
              className="ff-fpicker__option"
              data-active={f.id === value}
              style={{ paddingLeft: 10 + f.depth * 16 }}
              onMouseDown={(e) => { e.preventDefault(); onChange(f.id); setOpen(false); }}
            >
              <Ico name="folder" size={14} />
              <span>{f.title}</span>
              {f.id === value && <Ico name="check" size={14} style={{ marginLeft: 'auto' }} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DensityPreview({ cols, active }: { cols: number; active?: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${Math.min(cols, 8)}, 1fr)`,
      gap: 3,
    }}>
      {Array.from({ length: Math.min(cols, 8) * 2 }).map((_, i) => (
        <div key={i} style={{
          aspectRatio: 1,
          background: active ? 'color-mix(in oklab, var(--accent) 55%, var(--ink-3))' : 'var(--ink-3)',
          borderRadius: 3,
          transition: 'background 140ms ease-out',
        }} />
      ))}
    </div>
  );
}

export function GridViewPreview({ active }: { active?: boolean }) {
  const fill = active ? 'color-mix(in oklab, var(--accent) 55%, var(--ink-3))' : 'var(--ink-3)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, height: '100%', padding: '2px 0 6px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} style={{
            aspectRatio: 1,
            background: fill,
            borderRadius: 3,
            transition: 'background 140ms ease-out',
          }} />
        ))}
      </div>
    </div>
  );
}

export function ListViewPreview({ active }: { active?: boolean }) {
  const solid = active ? 'color-mix(in oklab, var(--accent) 55%, var(--ink-3))' : 'var(--ink-3)';
  const soft = active
    ? 'color-mix(in oklab, var(--accent) 30%, var(--ink-3))'
    : 'color-mix(in oklab, var(--ink-3) 70%, var(--ink-2))';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, height: '100%', padding: '2px 0' }}>
      <div style={{ height: 5, width: '45%', borderRadius: 3, background: soft, transition: 'background 140ms ease-out' }} />
      {[74, 58].map((w, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 16, height: 16, borderRadius: 5, background: solid, flexShrink: 0, transition: 'background 140ms ease-out' }} />
          <div style={{ height: 7, width: `${w}%`, borderRadius: 3, background: soft, transition: 'background 140ms ease-out' }} />
        </div>
      ))}
    </div>
  );
}

export function TileShapePreview({ shape, active }: { shape: TileShape; active?: boolean }) {
  const fill = active ? 'color-mix(in oklab, var(--accent) 55%, var(--ink-3))' : 'var(--ink-3)';
  // Match the real tile radii (tiles.css): squircle 0.28, rounded 0.16, circle 50%.
  const radius = shape === 'circle' ? '50%' : shape === 'rounded' ? '16%' : '28%';
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-start', gap: 7, padding: '2px 0' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 22, height: 22,
          borderRadius: radius,
          background: fill,
          transition: 'background 140ms ease-out, border-radius 140ms ease-out',
        }} />
      ))}
    </div>
  );
}

export function ThemeCardPreview({ light, compact }: { light?: boolean; compact?: boolean }) {
  // Compact variant (settings Appearance) — one row, smaller. Default keeps the
  // original two-row skeleton used by onboarding, so that flow is unchanged.
  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ height: 5, width: 40, background: light ? '#E0DCD2' : '#2B2926', borderRadius: 2 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {[0,1,2,3].map(i => (
            <div key={i} style={{ width: 11, height: 11, borderRadius: 3, background: light ? '#E6E1D5' : '#3A3835' }} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ height: 6, width: 60, background: light ? '#E0DCD2' : '#2B2926', borderRadius: 3 }} />
      <div style={{ display: 'flex', gap: 4 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: 4, background: light ? '#E6E1D5' : '#3A3835' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ width: 14, height: 14, borderRadius: 4, background: light ? '#EDE9DE' : '#332F2C' }} />
        ))}
      </div>
    </div>
  );
}

export function CustomLayoutPreview({ active }: { active?: boolean }) {
  const bars = [70, 45, 60, 35];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0' }}>
      {bars.map((w, i) => (
        <div key={i} style={{
          height: 6,
          width: `${w}%`,
          borderRadius: 3,
          background: active
            ? 'color-mix(in oklab, var(--accent) 55%, var(--ink-3))'
            : 'var(--ink-3)',
        }} />
      ))}
    </div>
  );
}

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onPreview?: (v: number) => void;
  formatValue?: (v: number) => string;
}

// Local drag state keeps the range input responsive at 60fps without
// dispatching a settings patch on every frame. onPreview lets the parent
// reflect intermediate values (e.g. by writing a CSS variable directly to the
// DOM) for live feedback while a settings commit only happens on release.
export function Slider({ value, min, max, step = 1, onChange, onPreview, formatValue }: SliderProps) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const displayValue = dragValue ?? value;

  useEffect(() => {
    if (dragValue !== null && dragValue === value) setDragValue(null);
  }, [value, dragValue]);

  const commit = useCallback(() => {
    if (dragValue === null) return;
    const committed = dragValue;
    if (committed !== value) onChange(committed);
  }, [dragValue, value, onChange]);

  return (
    <div className="ff-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={displayValue}
        onChange={(e) => {
          const next = Number(e.target.value);
          setDragValue(next);
          onPreview?.(next);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="ff-slider__value">{formatValue ? formatValue(displayValue) : String(displayValue)}</span>
    </div>
  );
}
