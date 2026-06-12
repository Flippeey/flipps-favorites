import type { TileShape, ViewMode } from '@/shared/messages';
import {
  CUSTOM_LAYOUT_PRESET,
  CustomLayoutPreview,
  DensityPreview,
  LAYOUT_PRESETS,
  Segmented,
  Slider,
  Toggle,
} from '../settings-controls';
import { FALLBACK_WORKSPACE } from './types';
import type { WorkspaceSectionProps } from './types';

export function LayoutSection({ workspace, onPatch }: WorkspaceSectionProps) {
  const ws = workspace ?? FALLBACK_WORKSPACE;
  const isCustom = ws.layoutPreset === 'custom';
  return (
    <div className="ff-set-section">
      <h3 className="ff-set-section__title">Layout</h3>
      <p className="ff-set-section__desc">Choose a preset, or fine-tune each control.</p>
      <div className="ff-card" style={{ marginBottom: 24 }}>
        <div className="ff-row">
          <div>
            <div className="ff-row__label">View</div>
            <div className="ff-row__hint">Grid shows folders as compact tiles; List unfolds every folder inline.</div>
          </div>
          <Segmented<ViewMode>
            options={[{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }]}
            value={ws.folderMode}
            onChange={(v) => onPatch({ folderMode: v })}
          />
        </div>
      </div>
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
