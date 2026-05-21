import { useState } from 'react';
import type { AppSettings, BookmarkNode, FolderMode, FolderOpenMode, LayoutPresetId } from '../../shared/messages';
import { Ico } from './Ico';
import { ACCENT_PRESETS, FolderPicker, LAYOUT_PRESETS } from './settings';

interface OnboardingProps {
  settings: AppSettings;
  tree: BookmarkNode[];
  onPatch: (patch: Partial<AppSettings>) => void;
  onFinish: () => void;
}

function DensityMini({ cols, active }: { cols: number; active?: boolean }) {
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
        }} />
      ))}
    </div>
  );
}

export function Onboarding({ settings, tree, onPatch, onFinish }: OnboardingProps) {
  const [step, setStep] = useState(0);

  const steps = [
    { title: "Welcome to Flipp's Favorites", desc: "A new-tab dashboard that uses your existing bookmarks. No imports. No accounts. Just a faster way to get where you're going." },
    { title: 'Pick your accent', desc: 'Pick the accent that feels right. You can change it any time in Settings.' },
    { title: 'Choose your layout', desc: 'Pick the density that fits your screen. You can fine-tune later in Settings.' },
    { title: 'How do you want to navigate?', desc: 'Folders can stay compact as tiles, or always show inline as sections. You can change this any time.' },
    { title: "You're all set", desc: 'Open Settings any time to tweak themes, layout, the dock and clock. Drag bookmarks to reorder. Right-click anywhere for context actions.' },
  ];
  const s = steps[step];

  return (
    <div className="ff-modal-scrim">
      <div className="ff-onboard" onClick={(e) => e.stopPropagation()}>
        <div className="ff-onboard__hero">
          <div className="ff-onboard__steps" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <div key={i} className="ff-onboard__step" data-active={i <= step} />
            ))}
          </div>
          <h2 className="ff-onboard__title">{s.title}</h2>
          <p className="ff-onboard__desc">{s.desc}</p>
        </div>
        <div className="ff-onboard__body">
          {step === 0 && (
            <div style={{ display: 'grid', placeItems: 'center', padding: '24px 0' }}>
              <div style={{
                width: 96, height: 96, borderRadius: 22,
                background: 'linear-gradient(180deg, #2A2826, #0A0908)',
                border: '1px solid var(--line-2)',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridTemplateRows: 'repeat(4, 1fr)',
                gap: 4, padding: 10,
                boxShadow: '0 24px 48px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}>
                {['#FF7A2B','#FFD479','#FF6B6B','#C96A7D','#7D60D8','#3F72DC','#23867B','#7BAE2C','#2F8F4E','#FFB454','#F1641E','#E94235','#1ABCFE','#60A5FA','#C85FA4','#FFB380'].map((c, i) => (
                  <div key={i} style={{ background: c, borderRadius: 4 }} />
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="ff-accents" style={{ margin: '24px auto', maxWidth: 420 }}>
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
          )}

          {step === 2 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 16 }}>
              {LAYOUT_PRESETS.map(p => {
                const active = settings.layoutPreset === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => onPatch({ layoutPreset: p.id as LayoutPresetId })}
                    className="ff-card"
                    style={{
                      textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
                      borderColor: active ? 'var(--accent)' : 'var(--line-1)',
                      background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
                      boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                      transition: 'all 140ms ease-out',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600 }}>{p.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--fg-3)' }}>{p.desc}</span>
                    </div>
                    <DensityMini cols={p.cols} active={active} />
                  </button>
                );
              })}
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
              <div className="ff-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div className="ff-row__label">Root folder</div>
                  <div className="ff-row__hint">Your starting view. Change later in Settings.</div>
                </div>
                <FolderPicker
                  tree={tree}
                  value={settings.rootFolderId}
                  onChange={(id) => onPatch({ rootFolderId: id })}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {([
                  { id: 'tiles',    label: 'Tiles',    desc: 'Folders shown as one-click tiles. Keeps the top view tidy.' },
                  { id: 'sections', label: 'Sections', desc: 'Every folder unfolded inline. See everything at a glance.' },
                ] as { id: FolderMode; label: string; desc: string }[]).map(m => {
                  const active = settings.folderMode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => onPatch({ folderMode: m.id })}
                      className="ff-card"
                      style={{
                        textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
                        borderColor: active ? 'var(--accent)' : 'var(--line-1)',
                        background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
                        boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                        padding: 16,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.45 }}>{m.desc}</div>
                    </button>
                  );
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                {([
                  { id: 'overlay', label: 'Open folders as overlay', desc: 'Folder opens as a popup. Close to return to the main view.' },
                  { id: 'page',    label: 'Open folders as page',    desc: 'Folder fills the screen. Use the breadcrumb to step back.' },
                ] as { id: FolderOpenMode; label: string; desc: string }[]).map(m => {
                  const active = settings.folderOpenMode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => onPatch({ folderOpenMode: m.id })}
                      className="ff-card"
                      style={{
                        textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
                        borderColor: active ? 'var(--accent)' : 'var(--line-1)',
                        background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
                        boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                        padding: 16,
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.45 }}>{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 4 && (
            <div style={{ display: 'grid', placeItems: 'center', padding: '24px 0', fontSize: 13, color: 'var(--fg-3)' }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {([
                  ['⌘K', 'Search'],
                  ['⌘C/V', 'Move bookmarks'],
                  ['Right-click', 'Edit + organize'],
                  ['Drag', 'Reorder'],
                ] as const).map(([k, v]) => (
                  <div key={k} style={{
                    padding: '12px 16px',
                    border: '1px solid var(--line-1)',
                    borderRadius: 12,
                    background: 'var(--ink-2)',
                    display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center',
                    minWidth: 110,
                  }}>
                    <span className="ff-kbd">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <footer className="ff-onboard__foot">
          <button className="ff-iconbtn" onClick={onFinish}>Skip</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button className="ff-btn ff-btn--ghost" onClick={() => setStep(step - 1)}>
                <Ico name="chevronLeft" size={14} /> Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="ff-btn" onClick={() => setStep(step + 1)}>
                Next <Ico name="chevronRight" size={14} />
              </button>
            ) : (
              <button className="ff-btn" onClick={onFinish}>
                <Ico name="check" size={14} /> Get started
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
