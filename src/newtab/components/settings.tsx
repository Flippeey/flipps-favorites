import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type {
  AppSettings,
  BackgroundMode,
  BookmarkNode,
  FolderMode,
  FolderOpenMode,
  GradientStyle,
  LayoutPresetId,
  TileShape,
  ThemeMode,
} from '../../shared/messages';
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
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 40, height: 22,
        borderRadius: 11,
        background: on ? 'var(--accent)' : 'var(--ink-3)',
        border: '1px solid ' + (on ? 'color-mix(in oklab, var(--accent) 70%, #000)' : 'var(--line-1)'),
        position: 'relative',
        cursor: 'pointer',
        padding: 0,
        transition: 'background 140ms ease-out',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff',
        transition: 'left 140ms ease-out',
        boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
      }} />
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
    <div style={{
      display: 'inline-flex',
      padding: 2,
      background: 'var(--ink-3)',
      border: '1px solid var(--line-1)',
      borderRadius: 8,
      gap: 0,
    }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '6px 10px',
            background: value === o.id ? 'var(--accent)' : 'transparent',
            color: value === o.id ? '#fff' : 'var(--fg-2)',
            border: 0,
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'background 140ms ease-out, color 140ms ease-out',
          }}
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
}

export function SettingsDrawer({ settings, tree, onPatch, onClose }: SettingsDrawerProps) {
  const [section, setSection] = useState<SectionId>('appearance');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="ff-modal-scrim" onClick={onClose} style={{ background: 'rgba(0,0,0,0.35)' }} />
      <aside className="ff-drawer" role="dialog" aria-label="Settings">
        <header className="ff-drawer__head">
          <div>
            <div className="ff-dialog__eyebrow">Settings</div>
            <div className="ff-dialog__title">Workspace controls</div>
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
            {section === 'backup'     && <BackupSection />}
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
          <div>
            <div className="ff-row__label">Remember last folder</div>
            <div className="ff-row__hint">Open the last visited folder on a new tab.</div>
          </div>
          <Toggle on={settings.rememberLastFolder} onChange={(v) => onPatch({ rememberLastFolder: v })} />
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
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Show search bar</div>
            <div className="ff-row__hint">Subtle by default — expands when focused.</div>
          </div>
          <Toggle on={settings.showSearchBar} onChange={(v) => onPatch({ showSearchBar: v })} />
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
        <div className="ff-accents" style={{ marginBottom: 28 }}>
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
      </div>

      <div className="ff-set-section">
        <h3 className="ff-set-section__title">Background</h3>
        <p className="ff-set-section__desc">Solid, a soft accent gradient, or your own wallpaper.</p>
        <div className="ff-themegrid">
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

        {settings.backgroundMode === 'gradient' && (
          <>
            <div style={{ height: 12 }} />
            <p className="ff-set-section__desc" style={{ margin: 0, marginBottom: 8 }}>Pick a gradient style.</p>
            <div className="ff-themegrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {([
                { id: 'top', label: 'Top', bg: 'radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in oklab, var(--accent) 28%, transparent), transparent 70%), var(--ink-0)' },
                { id: 'top-bottom', label: 'Top + bottom', bg: 'radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in oklab, var(--accent) 26%, transparent), transparent 70%), radial-gradient(ellipse 80% 50% at 50% 100%, color-mix(in oklab, var(--accent) 22%, transparent), transparent 70%), var(--ink-0)' },
                { id: 'aurora', label: 'Aurora', bg: 'radial-gradient(ellipse 60% 50% at 20% 0%, color-mix(in oklab, var(--accent) 32%, transparent), transparent 60%), radial-gradient(ellipse 60% 40% at 80% 30%, color-mix(in oklab, var(--accent) 20%, transparent), transparent 60%), radial-gradient(ellipse 70% 40% at 50% 100%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 65%), var(--ink-0)' },
              ] as { id: GradientStyle; label: string; bg: string }[]).map(g => (
                <div
                  key={g.id}
                  className="ff-themecard"
                  data-active={settings.gradientStyle === g.id}
                  onClick={() => onPatch({ gradientStyle: g.id })}
                  style={{ gridColumn: 'auto', background: g.bg }}
                >
                  <div className="ff-themecard__label" style={{ color: 'var(--fg-1)' }}>{g.label}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {settings.backgroundMode === 'wallpaper' && <WallpaperPicker settings={settings} onPatch={onPatch} />}
      </div>
    </>
  );
}

function WallpaperPicker({ settings, onPatch }: SectionProps) {
  return (
    <>
      <div style={{ height: 12 }} />
      <div className="ff-card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
        <div
          style={{
            width: 64, height: 40,
            borderRadius: 8,
            backgroundImage: settings.customBackgroundImage ? `url(${settings.customBackgroundImage})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            background: settings.customBackgroundImage ? undefined : 'var(--ink-3)',
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
              const file = e.target.files?.[0];
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
        <div className="ff-row">
          <div className="ff-row__label">Show labels</div>
          <Toggle on={settings.showTileLabels} onChange={(v) => onPatch({ showTileLabels: v })} />
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

function BackupSection() {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Backup</h3>
      <p className="ff-set-section__desc">Export or restore your full workspace as a single JSON file.</p>
      <div className="ff-card" style={{ display: 'flex', gap: 12, padding: 16 }}>
        <button className="ff-btn ff-btn--ghost"><Ico name="download" size={14} /> Export workspace</button>
        <button className="ff-btn ff-btn--ghost"><Ico name="upload" size={14} /> Import…</button>
      </div>
      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--fg-3)' }}>
        Includes bookmark structure, icon overrides, accent + theme, layout, dock, and clock preferences.
      </div>
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
