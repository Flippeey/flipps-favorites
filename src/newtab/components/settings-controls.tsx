import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookmarkNode, LayoutPresetId } from '../../shared/messages';
import { Ico } from './Ico';

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

export const SOLID_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'noir',    label: 'Noir',     value: '#0A0908' },
  { id: 'warm',    label: 'Warm',     value: '#1A1110' },
  { id: 'navy',    label: 'Navy',     value: '#0F1A2B' },
  { id: 'slate',   label: 'Slate',    value: '#1F2937' },
  { id: 'paper',   label: 'Paper',    value: '#FAF7F0' },
  { id: 'sand',    label: 'Sand',     value: '#E5DDD0' },
];

export const GRADIENT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'blue',     label: 'Blue',     value: '#3F72DC' },
  { id: 'teal',     label: 'Teal',     value: '#23867B' },
  { id: 'purple',   label: 'Purple',   value: '#7D60D8' },
  { id: 'orange',   label: 'Orange',   value: '#F57C00' },
  { id: 'pink',     label: 'Pink',     value: '#C85FA4' },
  { id: 'slate',    label: 'Slate',    value: '#778292' },
];

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
          {o.label}
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
              onClick={() => { onChange(f.id); setOpen(false); }}
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

export function ThemeCardPreview({ light }: { light?: boolean }) {
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

export interface BgChip {
  id: string;
  label: string;
  background: string;   // CSS color value (hex or var)
  active: boolean;
  onClick: () => void;
}

interface BgColorPickerProps {
  chips: BgChip[];
  customActive: boolean;
  customColor: string;
  onCustomColorChange: (hex: string) => void;
}

export function BgColorPicker({ chips, customActive, customColor, onCustomColorChange }: BgColorPickerProps) {
  return (
    <div className="ff-bg-row">
      <div className="ff-accents" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        {chips.map(c => (
          <button
            key={c.id}
            type="button"
            className="ff-accentchip"
            data-active={c.active}
            onClick={c.onClick}
            style={{ background: c.background, color: c.background }}
            aria-label={c.label}
          >
            <span className="ff-accentchip__label">{c.label}</span>
          </button>
        ))}
      </div>
      <label className={`ff-accent-custom-btn${customActive ? ' ff-accent-custom-btn--active' : ''}`} style={{ marginTop: 10 }}>
        <span className="ff-accent-custom-swatch" style={{ background: customColor }} />
        <span>{customActive ? `Custom (${customColor.toUpperCase()})` : 'Custom…'}</span>
        <input
          type="color"
          value={customColor}
          onChange={(e) => onCustomColorChange(e.target.value)}
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        />
      </label>
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
