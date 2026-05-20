import { useCallback, useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import type {
  AppSettings,
  BackgroundColorSource,
  BackgroundFitMode,
  BackgroundMode,
  BackgroundPositionMode,
  BookmarkNode,
  FolderMode,
  FolderOpenMode,
  GradientStyle,
  LayoutPresetId,
  TileShape,
  ThemeMode,
} from '../../shared/messages';
import {
  applyWorkspaceImport,
  buildWorkspaceExport,
  downloadWorkspaceExport,
  parseWorkspaceFile,
  type WorkspaceImportMode,
} from '../lib/workspace-transfer';
import { useBlobUrl } from '../lib/useBlobUrl';
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
  { id: 'compact',      label: 'Compact',      desc: '12 columns, dense',    cols: 12 },
  { id: 'balanced',     label: 'Balanced',     desc: '10 columns, default',  cols: 10 },
  { id: 'spacious',     label: 'Spacious',     desc: '8 columns, roomy',     cols: 8 },
  { id: 'presentation', label: 'Presentation', desc: '6 columns, large',     cols: 6 },
];

// Small reusable controls
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

function DensityPreview({ cols, active }: { cols: number; active?: boolean }) {
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

function ThemeCardPreview({ light }: { light?: boolean }) {
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

type SectionId = 'general' | 'navigation' | 'appearance' | 'layout' | 'dock' | 'clock' | 'backup' | 'help';

interface SettingsDrawerProps {
  settings: AppSettings;
  tree: BookmarkNode[];
  onPatch: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  onAfterImport: (settings: AppSettings) => void;
}

export function SettingsDrawer({ settings, tree, onPatch, onClose, onAfterImport }: SettingsDrawerProps) {
  const [section, setSection] = useState<SectionId>('appearance');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="ff-modal-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ background: 'rgba(0,0,0,0.35)' }} />
      <aside className="ff-drawer" role="dialog" aria-label="Settings">
        <header className="ff-drawer__head">
          <div>
            <div className="ff-dialog__eyebrow">Settings</div>
            <div className="ff-dialog__title">Personalize</div>
          </div>
          <button className="ff-iconbtn ff-iconbtn--icon" aria-label="Close" onClick={onClose}>
            <Ico name="close" size={16} />
          </button>
        </header>
        <div className="ff-drawer__body">
          <nav className="ff-drawer__nav">
            <DrawerNav id="general"    label="General"    icon="layoutGrid" active={section} setActive={setSection} />
            <DrawerNav id="navigation" label="Navigation" icon="command"    active={section} setActive={setSection} />
            <DrawerNav id="appearance" label="Appearance" icon="palette"    active={section} setActive={setSection} />
            <DrawerNav id="layout"     label="Layout"     icon="rows"       active={section} setActive={setSection} />
            <DrawerNav id="dock"       label="Dock"       icon="layers"     active={section} setActive={setSection} />
            <DrawerNav id="clock"      label="Clock"      icon="clock"      active={section} setActive={setSection} />
            <DrawerNav id="backup"     label="Backup"     icon="cloud"      active={section} setActive={setSection} />
            <div className="ff-drawer__navdivider" />
            <DrawerNav id="help"       label="Help"       icon="link"       active={section} setActive={setSection} />
          </nav>
          <div className="ff-drawer__content no-scrollbar">
            {section === 'general'    && <GeneralSection settings={settings} tree={tree} onPatch={onPatch} />}
            {section === 'navigation' && <NavigationSection settings={settings} onPatch={onPatch} />}
            {section === 'appearance' && <AppearanceSection settings={settings} onPatch={onPatch} />}
            {section === 'layout'     && <LayoutSection settings={settings} onPatch={onPatch} />}
            {section === 'dock'       && <DockSection settings={settings} tree={tree} onPatch={onPatch} />}
            {section === 'clock'      && <ClockSection settings={settings} onPatch={onPatch} />}
            {section === 'backup'     && <BackupSection onAfterImport={onAfterImport} />}
            {section === 'help'       && <HelpSection />}
          </div>
        </div>
      </aside>
    </>
  );
}

function DrawerNav({ id, label, icon, active, setActive }: {
  id: SectionId; label: string; icon: string; active: SectionId; setActive: (id: SectionId) => void;
}) {
  return (
    <button className="ff-drawer__navitem" data-active={active === id} onClick={() => setActive(id)}>
      <Ico name={icon} size={16} />
      <span>{label}</span>
    </button>
  );
}

interface SectionProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void;
}

function GeneralSection({ settings, tree, onPatch }: SectionProps & { tree: BookmarkNode[] }) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">General</h3>
      <p className="ff-set-section__desc">Workspace defaults and behavior.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Show labels</div>
          <Toggle on={settings.showTileLabels} onChange={(v) => onPatch({ showTileLabels: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Show search bar</div>
            <div className="ff-row__hint">Subtle by default — expands when focused.</div>
          </div>
          <Toggle on={settings.showSearchBar} onChange={(v) => onPatch({ showSearchBar: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Default workspace folder</div>
            <div className="ff-row__hint">The root shown on every new tab.</div>
          </div>
          <FolderPicker
            tree={tree}
            value={settings.rootFolderId}
            onChange={(id) => onPatch({ rootFolderId: id })}
          />
        </div>
      </div>
    </div>
  );
}

function NavigationSection({ settings, onPatch }: SectionProps) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Navigation</h3>
      <p className="ff-set-section__desc">How you move around the new tab page.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Remember last folder</div>
            <div className="ff-row__hint">Open the last visited folder on a new tab.</div>
          </div>
          <Toggle on={settings.rememberLastFolder} onChange={(v) => onPatch({ rememberLastFolder: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Folder mode</div>
            <div className="ff-row__hint">Tiles keep folders compact; sections show every folder inline.</div>
          </div>
          <Segmented<FolderMode>
            options={[{ id: 'tiles', label: 'Tiles' }, { id: 'sections', label: 'Sections' }]}
            value={settings.folderMode}
            onChange={(v) => onPatch({ folderMode: v })}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Open folders as</div>
            <div className="ff-row__hint">Overlay keeps the page underneath; Page navigates in with breadcrumbs.</div>
          </div>
          <Segmented<FolderOpenMode>
            options={[{ id: 'overlay', label: 'Overlay' }, { id: 'page', label: 'Page' }]}
            value={settings.folderOpenMode}
            onChange={(v) => onPatch({ folderOpenMode: v })}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Open bookmarks in new tab</div>
            <div className="ff-row__hint">Hold Ctrl/Cmd to override per click.</div>
          </div>
          <Toggle on={settings.openLinksInNewTab} onChange={(v) => onPatch({ openLinksInNewTab: v })} />
        </div>
      </div>
    </div>
  );
}

function AppearanceSection({ settings, onPatch }: SectionProps) {
  return (
    <>
      <div className="ff-set-section">
        <h3 className="ff-set-section__title">Theme</h3>
        <p className="ff-set-section__desc">Choose light or dark directly, or follow the browser preference automatically.</p>
        <div className="ff-card" style={{ marginBottom: 16 }}>
          <div className="ff-row" style={{ padding: 0 }}>
            <div>
              <div className="ff-row__label">Use system preference</div>
              <div className="ff-row__hint">Light and dark cards below update to show which mode is currently active.</div>
            </div>
            <Toggle
              on={settings.themeMode === 'system'}
              onChange={(v) => onPatch({ themeMode: (v ? 'system' : 'dark') as ThemeMode })}
            />
          </div>
        </div>
        <div className="ff-themegrid">
          <div className="ff-themecard ff-themecard--light" data-active={settings.themeMode === 'light'} onClick={() => onPatch({ themeMode: 'light' })}>
            <ThemeCardPreview light />
            <div className="ff-themecard__label">Light</div>
          </div>
          <div className="ff-themecard ff-themecard--dark" data-active={settings.themeMode === 'dark'} onClick={() => onPatch({ themeMode: 'dark' })}>
            <ThemeCardPreview />
            <div className="ff-themecard__label">Dark</div>
          </div>
        </div>
      </div>

      <div className="ff-set-section">
        <h3 className="ff-set-section__title">Accent</h3>
        <p className="ff-set-section__desc">Pick a palette colour.</p>
        <div className="ff-accents" style={{ marginBottom: 8 }}>
          {ACCENT_PRESETS.map(a => (
            <button
              key={a.id}
              className="ff-accentchip"
              data-active={settings.accentColor.toUpperCase() === a.value.toUpperCase()}
              onClick={() => onPatch({ accentColor: a.value })}
              style={{ background: a.value, color: a.value }}
              aria-label={a.label}
            >
              <span className="ff-accentchip__label">{a.label}</span>
            </button>
          ))}
        </div>
        {(() => {
          const isCustom = !ACCENT_PRESETS.some(a => a.value.toUpperCase() === settings.accentColor.toUpperCase());
          return (
            <div style={{ marginBottom: 28 }}>
              <label className={`ff-accent-custom-btn${isCustom ? ' ff-accent-custom-btn--active' : ''}`}>
                <span className="ff-accent-custom-swatch" style={{ background: settings.accentColor }} />
                <span>{isCustom ? `Custom (${settings.accentColor.toUpperCase()})` : 'Custom…'}</span>
                <input
                  type="color"
                  value={settings.accentColor}
                  onChange={(e) => onPatch({ accentColor: e.target.value })}
                  style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
                />
              </label>
            </div>
          );
        })()}
      </div>

      <div className="ff-set-section">
        <h3 className="ff-set-section__title">Background</h3>
        <p className="ff-set-section__desc">Solid, a soft accent gradient, or your own wallpaper.</p>
        <div className="ff-themegrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(['solid', 'gradient', 'wallpaper'] as BackgroundMode[]).map(opt => (
            <div
              key={opt}
              className="ff-themecard"
              data-active={settings.backgroundMode === opt}
              onClick={() => onPatch({ backgroundMode: opt })}
              style={{
                gridColumn: 'auto',
                background:
                  opt === 'solid' ? 'var(--ink-0)' :
                  opt === 'gradient' ? 'radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in oklab, var(--accent) 28%, transparent), transparent 70%), var(--ink-0)' :
                  'linear-gradient(135deg, #1A1110, #0A0908)',
              }}
            >
              <div className="ff-themecard__label" style={{ color: 'var(--fg-1)', textTransform: 'capitalize' }}>{opt}</div>
            </div>
          ))}
        </div>

        <div className="ff-bg-panel">
          {settings.backgroundMode === 'solid' && <SolidPanel settings={settings} onPatch={onPatch} />}
          {settings.backgroundMode === 'gradient' && <GradientPanel settings={settings} onPatch={onPatch} />}
          {settings.backgroundMode === 'wallpaper' && <WallpaperPicker settings={settings} onPatch={onPatch} />}
        </div>
      </div>
    </>
  );
}

const SOLID_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'noir',    label: 'Noir',     value: '#0A0908' },
  { id: 'warm',    label: 'Warm',     value: '#1A1110' },
  { id: 'navy',    label: 'Navy',     value: '#0F1A2B' },
  { id: 'slate',   label: 'Slate',    value: '#1F2937' },
  { id: 'paper',   label: 'Paper',    value: '#FAF7F0' },
  { id: 'sand',    label: 'Sand',     value: '#E5DDD0' },
];

const GRADIENT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'blue',     label: 'Blue',     value: '#3F72DC' },
  { id: 'teal',     label: 'Teal',     value: '#23867B' },
  { id: 'purple',   label: 'Purple',   value: '#7D60D8' },
  { id: 'orange',   label: 'Orange',   value: '#F57C00' },
  { id: 'pink',     label: 'Pink',     value: '#C85FA4' },
  { id: 'slate',    label: 'Slate',    value: '#778292' },
];

interface BgChip {
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

function BgColorPicker({ chips, customActive, customColor, onCustomColorChange }: BgColorPickerProps) {
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

function SolidPanel({ settings, onPatch }: SectionProps) {
  const currentHex = settings.solidBackgroundColor.toUpperCase();
  const isTheme = currentHex === '';
  const matchingPreset = SOLID_PRESETS.find(p => p.value.toUpperCase() === currentHex);
  const customActive = !isTheme && !matchingPreset;
  const customValue = settings.solidBackgroundColor || '#141414';

  const chips: BgChip[] = [
    {
      id: 'theme',
      label: 'Theme',
      background: 'var(--ink-0)',
      active: isTheme,
      onClick: () => onPatch({ solidBackgroundColor: '' }),
    },
    ...SOLID_PRESETS.map(p => ({
      id: p.id,
      label: p.label,
      background: p.value,
      active: currentHex === p.value.toUpperCase(),
      onClick: () => onPatch({ solidBackgroundColor: p.value.toUpperCase() }),
    })),
  ];

  return (
    <BgColorPicker
      chips={chips}
      customActive={customActive}
      customColor={customValue}
      onCustomColorChange={(hex) => onPatch({ solidBackgroundColor: hex.toUpperCase() })}
    />
  );
}

const GRADIENT_STYLES: { id: GradientStyle; label: string }[] = [
  { id: 'top',         label: 'Top' },
  { id: 'top-bottom',  label: 'Top + bottom' },
  { id: 'bottom',      label: 'Bottom' },
  { id: 'aurora',      label: 'Aurora' },
  { id: 'mesh',        label: 'Mesh' },
  { id: 'vignette',    label: 'Vignette' },
];

function gradientPreviewBg(style: GradientStyle, color: string, intensity: number): string {
  const k = intensity / 100;
  const clamp = (p: number) => Math.max(0, Math.min(100, p * k));
  const mix = (pct: number) => `color-mix(in oklab, ${color} ${String(clamp(pct))}%, transparent)`;
  switch (style) {
    case 'top':
      return `radial-gradient(ellipse 80% 50% at 50% 0%, ${mix(28)}, transparent 70%), var(--ink-0)`;
    case 'top-bottom':
      return `radial-gradient(ellipse 80% 50% at 50% 0%, ${mix(26)}, transparent 70%), radial-gradient(ellipse 80% 50% at 50% 100%, ${mix(22)}, transparent 70%), var(--ink-0)`;
    case 'bottom':
      return `radial-gradient(ellipse 80% 50% at 50% 100%, ${mix(28)}, transparent 70%), var(--ink-0)`;
    case 'aurora':
      return `radial-gradient(ellipse 60% 50% at 20% 0%, ${mix(32)}, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 30%, ${mix(20)}, transparent 60%), radial-gradient(ellipse 70% 40% at 50% 100%, ${mix(18)}, transparent 65%), var(--ink-0)`;
    case 'mesh':
      return `radial-gradient(circle at 15% 20%, ${mix(34)}, transparent 45%), radial-gradient(circle at 85% 25%, ${mix(26)}, transparent 50%), radial-gradient(circle at 60% 90%, ${mix(28)}, transparent 55%), var(--ink-0)`;
    case 'vignette':
      return `radial-gradient(ellipse 70% 50% at 50% 50%, ${mix(24)}, transparent 70%), radial-gradient(ellipse 120% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%), var(--ink-0)`;
  }
}

function GradientPanel({ settings, onPatch }: SectionProps) {
  const isAccent = settings.gradientColorSource === 'accent';
  const currentHex = settings.gradientCustomColor.toUpperCase();
  const matchingPreset = !isAccent && GRADIENT_PRESETS.find(p => p.value.toUpperCase() === currentHex);
  const customActive = !isAccent && !matchingPreset;
  const resolvedColor = isAccent ? settings.accentColor : settings.gradientCustomColor;

  const chips: BgChip[] = [
    {
      id: 'accent',
      label: 'Accent',
      background: 'var(--accent)',
      active: isAccent,
      onClick: () => onPatch({ gradientColorSource: 'accent' }),
    },
    ...GRADIENT_PRESETS.map(p => ({
      id: p.id,
      label: p.label,
      background: p.value,
      active: !isAccent && currentHex === p.value.toUpperCase(),
      onClick: () => onPatch({ gradientColorSource: 'custom' as BackgroundColorSource, gradientCustomColor: p.value.toUpperCase() }),
    })),
  ];

  return (
    <>
      <BgColorPicker
        chips={chips}
        customActive={customActive}
        customColor={settings.gradientCustomColor}
        onCustomColorChange={(hex) => onPatch({ gradientColorSource: 'custom', gradientCustomColor: hex.toUpperCase() })}
      />
      <div className="ff-bg-row">
        <div className="ff-row__hint" style={{ marginBottom: 8 }}>Style</div>
        <div className="ff-themegrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {GRADIENT_STYLES.map(g => (
            <div
              key={g.id}
              className="ff-themecard"
              data-active={settings.gradientStyle === g.id}
              onClick={() => onPatch({ gradientStyle: g.id })}
              style={{ gridColumn: 'auto', background: gradientPreviewBg(g.id, resolvedColor, settings.gradientIntensity) }}
            >
              <div className="ff-themecard__label" style={{ color: 'var(--fg-1)' }}>{g.label}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="ff-bg-row">
        <div className="ff-bg-row__head">
          <div>
            <div className="ff-row__label">Intensity</div>
            <div className="ff-row__hint">Dial the gradient strength up or down.</div>
          </div>
          <Slider
            value={settings.gradientIntensity}
            min={0}
            max={200}
            step={5}
            onChange={(v) => onPatch({ gradientIntensity: v })}
            onPreview={(v) => {
              const el = document.querySelector('.ff-app') as HTMLElement | null;
              if (el) el.style.setProperty('--gradient-intensity', String(v / 100));
            }}
            formatValue={(v) => `${String(v)}%`}
          />
        </div>
      </div>
    </>
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
function Slider({ value, min, max, step = 1, onChange, onPreview, formatValue }: SliderProps) {
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

function WallpaperPicker({ settings, onPatch }: SectionProps) {
  const previewUrl = useBlobUrl(settings.customBackgroundImage);
  return (
    <>
      <div className="ff-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
        <div
          style={{
            width: 64, height: 40,
            borderRadius: 8,
            backgroundImage: previewUrl ? `url(${previewUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundColor: settings.customBackgroundImage ? undefined : 'var(--ink-3)',
            border: '1px solid var(--line-1)',
            display: 'grid', placeItems: 'center',
            color: 'var(--fg-3)',
          } as CSSProperties}
        >
          {!settings.customBackgroundImage && <Ico name="upload" size={14} />}
        </div>
        <div style={{ flex: 1 }}>
          <div className="ff-row__label">{settings.customBackgroundImage ? 'Custom wallpaper' : 'No wallpaper selected'}</div>
          <div className="ff-row__hint">{settings.customBackgroundImage ? 'Stored locally in your browser.' : 'JPG, PNG, or WebP. Stays on your device.'}</div>
        </div>
        <label className="ff-btn ff-btn--ghost" style={{ cursor: 'pointer' }}>
          <Ico name="upload" size={14} /> {settings.customBackgroundImage ? 'Replace' : 'Browse…'}
          <input
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const input = e.target;
              const file = input.files?.[0];
              input.value = '';
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => onPatch({ customBackgroundImage: String(reader.result) });
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {settings.customBackgroundImage && (
          <button className="ff-btn ff-btn--ghost" onClick={() => onPatch({ customBackgroundImage: '' })}>
            <Ico name="trash" size={14} />
          </button>
        )}
      </div>
      {settings.customBackgroundImage && (
        <>
          <div className="ff-bg-row">
            <div className="ff-bg-row__head">
              <div>
                <div className="ff-row__label">Opacity</div>
                <div className="ff-row__hint">Blend the wallpaper toward the theme color.</div>
              </div>
              <Slider
                value={settings.backgroundOpacity}
                min={0}
                max={100}
                onChange={(v) => onPatch({ backgroundOpacity: v })}
                onPreview={(v) => {
                  const el = document.querySelector('.ff-app') as HTMLElement | null;
                  if (el) el.style.setProperty('--wallpaper-alpha', `${String(v)}%`);
                }}
                formatValue={(v) => `${String(v)}%`}
              />
            </div>
          </div>
          <div className="ff-bg-row">
            <div className="ff-bg-row__head">
              <div className="ff-row__label">Fit</div>
              <Segmented<BackgroundFitMode>
                options={[
                  { id: 'cover',   label: 'Cover' },
                  { id: 'contain', label: 'Contain' },
                  { id: 'fill',    label: 'Fill' },
                ]}
                value={settings.backgroundFitMode}
                onChange={(v) => onPatch({ backgroundFitMode: v })}
              />
            </div>
          </div>
          <div className="ff-bg-row">
            <div className="ff-bg-row__head">
              <div className="ff-row__label">Position</div>
              <Segmented<BackgroundPositionMode>
                options={[
                  { id: 'top',    label: 'Top' },
                  { id: 'center', label: 'Center' },
                  { id: 'bottom', label: 'Bottom' },
                ]}
                value={settings.backgroundPositionMode}
                onChange={(v) => onPatch({ backgroundPositionMode: v })}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function LayoutSection({ settings, onPatch }: SectionProps) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Layout</h3>
      <p className="ff-set-section__desc">Choose a preset, or fine-tune each control.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
        {LAYOUT_PRESETS.map(p => {
          const active = settings.layoutPreset === p.id;
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
      </div>
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Tile shape</div>
          <Segmented<TileShape>
            options={[
              { id: 'squircle', label: 'Squircle' },
              { id: 'rounded',  label: 'Rounded' },
              { id: 'circle',   label: 'Circle' },
            ]}
            value={settings.tileShape}
            onChange={(v) => onPatch({ tileShape: v })}
          />
        </div>
      </div>
    </div>
  );
}

function DockSection({ settings, tree, onPatch }: SectionProps & { tree: BookmarkNode[] }) {
  const visibility: 'always' | 'hover' | 'hidden' =
    !settings.showDock ? 'hidden' : settings.autoHideDock ? 'hover' : 'always';
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Dock</h3>
      <p className="ff-set-section__desc">A pinned row at the bottom for your most-used links.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Visibility</div>
          <Segmented<'always' | 'hover' | 'hidden'>
            options={[
              { id: 'always', label: 'Always' },
              { id: 'hover',  label: 'On hover' },
              { id: 'hidden', label: 'Hidden' },
            ]}
            value={visibility}
            onChange={(v) => {
              if (v === 'hidden') onPatch({ showDock: false });
              else if (v === 'hover') onPatch({ showDock: true, autoHideDock: true });
              else onPatch({ showDock: true, autoHideDock: false });
            }}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Source folder</div>
            <div className="ff-row__hint">Pulls items from this folder.</div>
          </div>
          <FolderPicker
            tree={tree}
            value={settings.dockFolderId}
            onChange={(id) => onPatch({ dockFolderId: id })}
          />
        </div>
      </div>
    </div>
  );
}

function ClockSection({ settings, onPatch }: SectionProps) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Clock & greeting</h3>
      <p className="ff-set-section__desc">Show the time above the search bar.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Show clock</div>
          <Toggle on={settings.showClock} onChange={(v) => onPatch({ showClock: v })} />
        </div>
        <div className="ff-row">
          <div className="ff-row__label">Hour format</div>
          <Segmented<'24' | '12'>
            options={[{ id: '24', label: '24 h' }, { id: '12', label: '12 h' }]}
            value={settings.clockHourFormat}
            onChange={(v) => onPatch({ clockHourFormat: v })}
          />
        </div>
      </div>
    </div>
  );
}

interface BackupSectionProps {
  onAfterImport: (settings: AppSettings) => void;
}

type BackupStatus = { kind: 'success' | 'error'; text: string } | null;

function BackupSection({ onAfterImport }: BackupSectionProps) {
  const [busy, setBusy] = useState<'idle' | 'exporting' | 'importing'>('idle');
  const [status, setStatus] = useState<BackupStatus>(null);
  const [importMode, setImportMode] = useState<WorkspaceImportMode>('merge');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!status) return;
    const id = window.setTimeout(() => setStatus(null), 4000);
    return () => window.clearTimeout(id);
  }, [status]);

  const handleExport = async () => {
    if (busy !== 'idle') return;
    setBusy('exporting');
    setStatus(null);
    try {
      const payload = await buildWorkspaceExport();
      downloadWorkspaceExport(payload);
      const overrideLabel = payload.iconOverrides.length === 1 ? 'icon override' : 'icon overrides';
      setStatus({
        kind: 'success',
        text: `Exported settings and ${String(payload.iconOverrides.length)} ${overrideLabel}.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to export workspace data.',
      });
    } finally {
      setBusy('idle');
    }
  };

  const handlePickFile = () => {
    if (busy !== 'idle') return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('importing');
    setStatus(null);
    try {
      const payload = await parseWorkspaceFile(file);
      const summary = await applyWorkspaceImport(payload, importMode);
      onAfterImport(summary.settings);
      const overrideLabel = summary.iconOverrideCount === 1 ? 'icon override' : 'icon overrides';
      setStatus({
        kind: 'success',
        text: `Imported settings and ${String(summary.iconOverrideCount)} ${overrideLabel} (${summary.mode} mode).`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to import workspace data.',
      });
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Backup</h3>
      <p className="ff-set-section__desc">
        Save your settings and custom icon overrides to a JSON file, or restore from one. Bookmarks
        and folders sync through the browser — use the browser&rsquo;s built-in bookmark export to move them.
      </p>

      <div className="ff-card" style={{ marginBottom: 16 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Export workspace</div>
            <div className="ff-row__hint">Downloads a JSON file with your settings, icon overrides, and usage history.</div>
          </div>
          <button
            type="button"
            className="ff-btn ff-btn--ghost"
            onClick={handleExport}
            disabled={busy !== 'idle'}
          >
            <Ico name="download" size={14} /> {busy === 'exporting' ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>

      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Import mode</div>
            <div className="ff-row__hint">Merge keeps existing data and overlays the file. Replace wipes settings and icon overrides first.</div>
          </div>
          <Segmented<WorkspaceImportMode>
            options={[{ id: 'merge', label: 'Merge' }, { id: 'replace', label: 'Replace' }]}
            value={importMode}
            onChange={setImportMode}
          />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Import workspace</div>
            <div className="ff-row__hint">Choose a JSON file previously exported from Flipp&rsquo;s Favorites.</div>
          </div>
          <button
            type="button"
            className="ff-btn ff-btn--ghost"
            onClick={handlePickFile}
            disabled={busy !== 'idle'}
          >
            <Ico name="upload" size={14} /> {busy === 'importing' ? 'Importing…' : 'Import…'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {status && (
        <div
          role="status"
          style={{
            marginTop: 12,
            fontSize: 12,
            color: status.kind === 'error' ? 'var(--danger, #C75252)' : 'var(--fg-2)',
          }}
        >
          {status.text}
        </div>
      )}
    </div>
  );
}

function HelpSection() {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Shortcuts</h3>
      <div className="ff-card">
        {([
          ['⌘K', 'Focus search'],
          ['⌘+Click', 'Open in new tab'],
          ['Esc', 'Clear selection / close dialog'],
          ['⌘C / ⌘X / ⌘V', 'Cut, copy and paste bookmarks'],
          ['⌘Z / ⌘⇧Z', 'Undo / redo'],
          ['Drag empty space', 'Marquee multi-select'],
        ] as const).map(([k, v]) => (
          <div className="ff-row" key={k}>
            <div className="ff-row__label">{v}</div>
            <span className="ff-kbd" style={{ fontSize: 12 }}>{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
