import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
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
  TileShape,
  ThemeMode,
  WorkspaceRecord,
} from '../../shared/messages';
import {
  applyWorkspaceImport,
  buildWorkspaceExport,
  downloadWorkspaceExport,
  parseWorkspaceFile,
  type WorkspaceImportMode,
} from '../lib/workspace-transfer';
import { defaultWorkspaceSettings } from '../../shared/storage';
import { MOD_KEY } from '../lib/platform';
import { useBlobUrl } from '../lib/useBlobUrl';
import { Ico } from './Ico';
import { FolderMultiPicker } from './FolderMultiPicker';
import {
  ACCENT_PRESETS,
  BgColorPicker,
  CUSTOM_LAYOUT_PRESET,
  CustomLayoutPreview,
  DensityPreview,
  GRADIENT_PRESETS,
  LAYOUT_PRESETS,
  Segmented,
  Slider,
  SOLID_PRESETS,
  ThemeCardPreview,
  Toggle,
  type BgChip,
} from './settings-controls';

const FALLBACK_WORKSPACE: WorkspaceRecord = {
  id: '', name: '', rootFolderId: '',
  ...defaultWorkspaceSettings,
};

interface SectionProps {
  settings: AppSettings;
  onPatch: (patch: Partial<AppSettings>) => void;
}

interface WorkspaceSectionProps {
  workspace: WorkspaceRecord | null;
  onPatch: (patch: Partial<WorkspaceRecord>) => void;
}

export function NavigationSection({ settings, onPatch }: SectionProps) {
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Navigation</h3>
      <p className="ff-set-section__desc">How you move around the new tab page.</p>
      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Show search bar</div>
            <div className="ff-row__hint">Subtle by default — expands when focused.</div>
          </div>
          <Toggle on={settings.showSearchBar} onChange={(v) => onPatch({ showSearchBar: v })} />
        </div>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Remember last workspace</div>
            <div className="ff-row__hint">Reopen the workspace you were using when you closed the tab.</div>
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

interface AppearanceSectionProps {
  workspace: WorkspaceRecord | null;
  workspaceWallpaper: string;
  onPatch: (patch: Partial<WorkspaceRecord>) => void;
  onSetWallpaper: (dataUrl: string) => void;
  settings: AppSettings;
}

export function AppearanceSection({ workspace, workspaceWallpaper, onPatch, onSetWallpaper, settings }: AppearanceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const themeMode: ThemeMode = ws.themeMode ?? settings.themeMode;
  return (
    <>
      <div className="ff-set-section">
        <h3 className="ff-set-section__title">Theme</h3>
        <p className="ff-set-section__desc">Choose light or dark directly, or follow the browser preference automatically.</p>
        <div className="ff-card" style={{ marginBottom: 16 }}>
          <div className="ff-row" style={{ padding: 0 }}>
            <div>
              <div className="ff-row__label">Use system preference</div>
              <div className="ff-row__hint">The cards below reflect the active mode.</div>
            </div>
            <Toggle
              on={themeMode === 'system'}
              onChange={(v) => onPatch({ themeMode: (v ? 'system' : 'dark') as ThemeMode })}
            />
          </div>
        </div>
        <div className="ff-themegrid">
          <button type="button" className="ff-themecard ff-themecard--light" data-active={themeMode === 'light'} onClick={() => onPatch({ themeMode: 'light' })}>
            <ThemeCardPreview light />
            <div className="ff-themecard__label">Light</div>
          </button>
          <button type="button" className="ff-themecard ff-themecard--dark" data-active={themeMode === 'dark'} onClick={() => onPatch({ themeMode: 'dark' })}>
            <ThemeCardPreview />
            <div className="ff-themecard__label">Dark</div>
          </button>
        </div>
      </div>

      <div className="ff-set-section">
        <h3 className="ff-set-section__title">Accent</h3>
        <p className="ff-set-section__desc">Pick a palette color.</p>
        <div className="ff-accents" style={{ marginBottom: 8 }}>
          {ACCENT_PRESETS.map(a => (
            <button
              key={a.id}
              className="ff-accentchip"
              data-active={ws.accentColor.toUpperCase() === a.value.toUpperCase()}
              onClick={() => onPatch({ accentColor: a.value })}
              style={{ background: a.value, color: a.value }}
              aria-label={a.label}
            >
              <span className="ff-accentchip__label">{a.label}</span>
            </button>
          ))}
        </div>
        {(() => {
          const isCustom = !ACCENT_PRESETS.some(a => a.value.toUpperCase() === ws.accentColor.toUpperCase());
          return (
            <div style={{ marginBottom: 28 }}>
              <label className={`ff-accent-custom-btn${isCustom ? ' ff-accent-custom-btn--active' : ''}`}>
                <span className="ff-accent-custom-swatch" style={{ background: ws.accentColor }} />
                <span>{isCustom ? `Custom (${ws.accentColor.toUpperCase()})` : 'Custom…'}</span>
                <input
                  type="color"
                  value={ws.accentColor}
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
            <button
              type="button"
              key={opt}
              className="ff-themecard"
              data-active={ws.backgroundMode === opt}
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
            </button>
          ))}
        </div>

        <div className="ff-bg-panel">
          {ws.backgroundMode === 'solid' && <SolidPanel workspace={workspace} onPatch={onPatch} />}
          {ws.backgroundMode === 'gradient' && <GradientPanel workspace={workspace} onPatch={onPatch} />}
          {ws.backgroundMode === 'wallpaper' && <WallpaperPicker wallpaper={workspaceWallpaper} onSetWallpaper={onSetWallpaper} workspace={workspace} onPatch={onPatch} />}
        </div>
      </div>
    </>
  );
}

function SolidPanel({ workspace, onPatch }: WorkspaceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const currentHex = ws.solidBackgroundColor.toUpperCase();
  const isTheme = currentHex === '';
  const matchingPreset = SOLID_PRESETS.find(p => p.value.toUpperCase() === currentHex);
  const customActive = !isTheme && !matchingPreset;
  const customValue = ws.solidBackgroundColor || '#141414';

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

function GradientPanel({ workspace, onPatch }: WorkspaceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const isAccent = ws.gradientColorSource === 'accent';
  const currentHex = ws.gradientCustomColor.toUpperCase();
  const matchingPreset = !isAccent && GRADIENT_PRESETS.find(p => p.value.toUpperCase() === currentHex);
  const customActive = !isAccent && !matchingPreset;
  const resolvedColor = isAccent ? ws.accentColor : ws.gradientCustomColor;

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
        customColor={ws.gradientCustomColor}
        onCustomColorChange={(hex) => onPatch({ gradientColorSource: 'custom', gradientCustomColor: hex.toUpperCase() })}
      />
      <div className="ff-bg-row">
        <div className="ff-row__hint" style={{ marginBottom: 8 }}>Style</div>
        <div className="ff-themegrid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {GRADIENT_STYLES.map(g => (
            <button
              type="button"
              key={g.id}
              className="ff-themecard"
              data-active={ws.gradientStyle === g.id}
              onClick={() => onPatch({ gradientStyle: g.id })}
              style={{ gridColumn: 'auto', background: gradientPreviewBg(g.id, resolvedColor, ws.gradientIntensity) }}
            >
              <div className="ff-themecard__label" style={{ color: 'var(--fg-1)' }}>{g.label}</div>
            </button>
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
            value={ws.gradientIntensity}
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

interface WallpaperPickerProps {
  wallpaper: string;
  onSetWallpaper: (dataUrl: string) => void;
  workspace: WorkspaceRecord | null;
  onPatch: (patch: Partial<WorkspaceRecord>) => void;
}

function WallpaperPicker({ wallpaper, onSetWallpaper, workspace, onPatch }: WallpaperPickerProps) {
  const previewUrl = useBlobUrl(wallpaper);
  const ws = workspace ?? FALLBACK_WORKSPACE;
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
            backgroundColor: wallpaper ? undefined : 'var(--ink-3)',
            border: '1px solid var(--line-1)',
            display: 'grid', placeItems: 'center',
            color: 'var(--fg-3)',
          } as CSSProperties}
        >
          {!wallpaper && <Ico name="upload" size={14} />}
        </div>
        <div style={{ flex: 1 }}>
          <div className="ff-row__label">{wallpaper ? 'Custom wallpaper' : 'No wallpaper selected'}</div>
          <div className="ff-row__hint">{wallpaper ? 'Stored locally in your browser.' : 'JPG, PNG, or WebP. Stays on your device.'}</div>
        </div>
        <label className="ff-btn ff-btn--ghost" style={{ cursor: 'pointer' }}>
          <Ico name="upload" size={14} /> {wallpaper ? 'Replace' : 'Browse…'}
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
              reader.onload = () => onSetWallpaper(String(reader.result));
              reader.readAsDataURL(file);
            }}
          />
        </label>
        {wallpaper && (
          <button className="ff-btn ff-btn--ghost" onClick={() => onSetWallpaper('')}>
            <Ico name="trash" size={14} />
          </button>
        )}
      </div>
      {wallpaper && (
        <>
          <div className="ff-bg-row">
            <div className="ff-bg-row__head">
              <div>
                <div className="ff-row__label">Opacity</div>
                <div className="ff-row__hint">Blend the wallpaper toward the theme color.</div>
              </div>
              <Slider
                value={ws.backgroundOpacity}
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
                value={ws.backgroundFitMode}
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
                value={ws.backgroundPositionMode}
                onChange={(v) => onPatch({ backgroundPositionMode: v })}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function LayoutSection({ workspace, onPatch }: WorkspaceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const isCustom = ws.layoutPreset === 'custom';
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Layout</h3>
      <p className="ff-set-section__desc">Choose a preset, or fine-tune each control.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
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
              <div className="ff-row__label">Icon size</div>
              <div className="ff-row__hint">How big each tile icon renders.</div>
            </div>
            <Slider
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
              <div className="ff-row__label">Tile width</div>
              <div className="ff-row__hint">Cell width — affects label wrapping and column count.</div>
            </div>
            <Slider
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
              <div className="ff-row__label">Column gap</div>
              <div className="ff-row__hint">Horizontal space between tiles.</div>
            </div>
            <Slider
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
              <div className="ff-row__label">Row gap</div>
              <div className="ff-row__hint">Vertical space between tiles.</div>
            </div>
            <Slider
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
      <div className="ff-card">
        <div className="ff-row">
          <div className="ff-row__label">Tile shape</div>
          <Segmented<TileShape>
            options={[
              { id: 'squircle', label: 'Squircle' },
              { id: 'rounded',  label: 'Rounded' },
              { id: 'circle',   label: 'Circle' },
            ]}
            value={ws.tileShape}
            onChange={(v) => onPatch({ tileShape: v })}
          />
        </div>
      </div>
      <div className="ff-card" style={{ marginTop: 16 }}>
        <div className="ff-row">
          <div className="ff-row__label">Show tile labels</div>
          <Toggle on={ws.showTileLabels} onChange={(v) => onPatch({ showTileLabels: v })} />
        </div>
      </div>
    </div>
  );
}

export function DockSection({ settings, tree, onPatch }: SectionProps & { tree: BookmarkNode[] }) {
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
        <div style={{ padding: 'var(--s-3) 0' }}>
          <div className="ff-row__label" style={{ marginBottom: 4 }}>Source folder</div>
          <div className="ff-row__hint" style={{ marginBottom: 8 }}>Show items from this folder.</div>
          <FolderMultiPicker
            tree={tree}
            selectedIds={settings.dockFolderId ? [settings.dockFolderId] : []}
            onToggle={(id) => onPatch({ dockFolderId: id })}
          />
        </div>
      </div>
    </div>
  );
}

export function ClockSection({ settings, onPatch }: SectionProps) {
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

export function BackupSection({ onAfterImport }: BackupSectionProps) {
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
      const wsLabel = payload.workspaces.length === 1 ? 'workspace' : 'workspaces';
      const overrideLabel = payload.iconOverrides.length === 1 ? 'icon override' : 'icon overrides';
      setStatus({
        kind: 'success',
        text: `Exported ${String(payload.workspaces.length)} ${wsLabel} and ${String(payload.iconOverrides.length)} ${overrideLabel}.`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to export settings.',
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
      const wsLabel = summary.workspaceCount === 1 ? 'workspace' : 'workspaces';
      const overrideLabel = summary.iconOverrideCount === 1 ? 'icon override' : 'icon overrides';
      setStatus({
        kind: 'success',
        text: `Imported ${String(summary.workspaceCount)} ${wsLabel} and ${String(summary.iconOverrideCount)} ${overrideLabel} (${summary.mode} mode).`,
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text: error instanceof Error ? error.message : 'Failed to import settings.',
      });
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Backup</h3>
      <p className="ff-set-section__desc">
        Save all your workspaces, settings, and icon overrides to a file, or restore from one. Bookmarks
        and folders sync through the browser — use the browser&rsquo;s built-in bookmark export to move them.
      </p>

      <div className="ff-card" style={{ marginBottom: 16 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Export settings</div>
            <div className="ff-row__hint">Downloads a JSON file with all workspaces, icon overrides, and usage history.</div>
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
            <div className="ff-row__label">Import settings</div>
            <div className="ff-row__hint">Restore from a previously exported Flipp&rsquo;s Favorites backup.</div>
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

export function HelpSection() {
  const mod = MOD_KEY;
  const shortcuts: ReadonlyArray<readonly [string, string]> = [
    [`${mod}+K  or  S  or  /`,    'Focus search'],
    ['A',                          'Add bookmark'],
    ['F',                          'Add folder'],
    ['W',                          'New workspace'],
    ['E',                          'Edit selected item'],
    ['?',                          'Open help & shortcuts'],
    ['Escape',                     'Close dialog, clear selection, blur search'],
    ['Alt+1-9',                    'Switch to workspace 1-9'],
    ['Arrow keys',                 'Navigate between bookmarks'],
    ['Enter',                      'Open focused bookmark or folder'],
    [`${mod}+Click`,               'Toggle item in selection'],
    ['Shift+Click',                'Select range from last clicked'],
    ['Delete',                     'Delete focused bookmark'],
  ];

  const tips: ReadonlyArray<readonly [string, string]> = [
    ['Drag & drop',        'Drag bookmarks to reorder, move into folders, or drop on workspace tabs to move between workspaces. Requires "Manual" sort mode.'],
    ['Marquee select',     'Click and drag on empty space to rubber-band select multiple bookmarks at once.'],
    ['Right-click anywhere','Context menu adapts to what you click — bookmark, folder, or empty space. Quick way to add, edit, or delete.'],
    ['Custom icons',       'Edit any bookmark to swap its icon. Search for alternatives, upload your own, or paste an image URL.'],
    ['Workspaces',         'Each workspace can have its own accent color, background, and layout. Use the + button or Settings to create more.'],
    ['Dock',               'Pin your most-used links to a bottom bar. Configure visibility and source folder in Settings → Dock.'],
  ];

  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Shortcuts</h3>
      <p className="ff-set-section__desc">Work smarter, not harder.</p>
      <div className="ff-card" style={{ marginBottom: 16 }}>
        {shortcuts.map(([kbd, label]) => (
          <div className="ff-row" key={kbd}>
            <div className="ff-row__label">{label}</div>
            <span className="ff-kbd" style={{ fontSize: 12 }}>{kbd}</span>
          </div>
        ))}
      </div>

      <h3 className="ff-set-section__title">Tips</h3>
      <p className="ff-set-section__desc">To help you get started or discover new features.</p>
      <div className="ff-card" style={{ marginBottom: 16 }}>
        {tips.map(([label, body]) => (
          <div className="ff-row" key={label} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div className="ff-row__label">{label}</div>
              <div className="ff-row__hint">{body}</div>
            </div>
          </div>
        ))}
      </div>

      <h3 className="ff-set-section__title">About</h3>
      <div className="ff-card">
        <div className="ff-row">
          <div>
            <div className="ff-row__label">Flipp&rsquo;s Favorites</div>
            <div className="ff-row__hint"><a href="https://www.flippflix.com/" target="_blank" rel="noopener noreferrer">
              https://www.flippflix.com/
            </a></div>
          </div>
        </div>
      </div>
    </div>
  );
}
