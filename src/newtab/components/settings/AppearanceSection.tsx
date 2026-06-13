import { type CSSProperties } from 'react';
import type {
  BackgroundFitMode,
  BackgroundMode,
  BackgroundPositionMode,
  GradientStyle,
  ThemeMode,
  WorkspaceRecord,
} from '@/shared/messages';
import { useBlobUrl } from '@/newtab/lib/useBlobUrl';
import { Ico } from '../Ico';
import {
  ACCENT_PRESETS,
  SectionTitle,
  Segmented,
  Slider,
  ThemeCardPreview,
  Toggle,
} from '../settings-controls';
import { FALLBACK_WORKSPACE } from './types';
import type { SectionProps, WorkspaceSectionProps } from './types';

interface AppearanceSectionProps {
  workspace: WorkspaceRecord | null;
  workspaceWallpaper: string;
  onPatch: (patch: Partial<WorkspaceRecord>) => void;
  onSetWallpaper: (dataUrl: string) => void;
  settings: SectionProps['settings'];
}

export function AppearanceSection({ workspace, workspaceWallpaper, onPatch, onSetWallpaper, settings }: AppearanceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const themeMode: ThemeMode = ws.themeMode ?? settings.themeMode;
  return (
    <>
      <div className="ff-set-section">
        <SectionTitle>Theme</SectionTitle>
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
        <div className="ff-themegrid ff-themegrid--compact">
          <button type="button" className="ff-themecard ff-themecard--light" data-active={themeMode === 'light'} onClick={() => onPatch({ themeMode: 'light' })}>
            <ThemeCardPreview light compact />
            <div className="ff-themecard__label">Light</div>
          </button>
          <button type="button" className="ff-themecard ff-themecard--dark" data-active={themeMode === 'dark'} onClick={() => onPatch({ themeMode: 'dark' })}>
            <ThemeCardPreview compact />
            <div className="ff-themecard__label">Dark</div>
          </button>
        </div>

        <SectionTitle>Accent</SectionTitle>
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
            <div>
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

        <SectionTitle>Background</SectionTitle>
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
  const isTheme = ws.solidBackgroundColor.toUpperCase() === '';
  const customActive = !isTheme;
  const customValue = ws.solidBackgroundColor || '#141414';

  return (
    <div className="ff-bg-row">
      <div className="ff-bg-row__title">Color</div>
      <div className="ff-accents">
        <button
          type="button"
          className="ff-accentchip"
          data-active={isTheme}
          onClick={() => onPatch({ solidBackgroundColor: '' })}
          style={{ background: 'var(--ink-0)', color: 'var(--ink-0)' }}
          aria-label="Theme"
        >
          <span className="ff-accentchip__label">Theme</span>
        </button>
        <label
          className="ff-accentchip ff-accentchip--custom"
          data-active={customActive}
          style={customActive ? { background: customValue, color: customValue } : undefined}
          aria-label="Custom color"
        >
          <span className="ff-accentchip__label">Custom</span>
          <input
            type="color"
            value={customValue}
            onChange={(e) => onPatch({ solidBackgroundColor: e.target.value.toUpperCase() })}
            style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
          />
        </label>
      </div>
    </div>
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
  const customActive = !isAccent;
  const resolvedColor = isAccent ? ws.accentColor : ws.gradientCustomColor;

  return (
    <>
      <div className="ff-bg-row">
        <div className="ff-bg-row__title">Color</div>
        <div className="ff-accents">
          <button
            type="button"
            className="ff-accentchip"
            data-active={isAccent}
            onClick={() => onPatch({ gradientColorSource: 'accent' })}
            style={{ background: 'var(--accent)', color: 'var(--accent)' }}
            aria-label="Accent"
          >
            <span className="ff-accentchip__label">Accent</span>
          </button>
          <label
            className="ff-accentchip ff-accentchip--custom"
            data-active={customActive}
            style={customActive ? { background: ws.gradientCustomColor, color: ws.gradientCustomColor } : undefined}
            aria-label="Custom color"
          >
            <span className="ff-accentchip__label">Custom</span>
            <input
              type="color"
              value={ws.gradientCustomColor}
              onChange={(e) => onPatch({ gradientColorSource: 'custom', gradientCustomColor: e.target.value.toUpperCase() })}
              style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
            />
          </label>
        </div>
      </div>
      <div className="ff-bg-row">
        <div className="ff-bg-row__title">Style</div>
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
