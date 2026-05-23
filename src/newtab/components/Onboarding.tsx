import { useState } from 'react';
import type { AppSettings, BookmarkNode, FolderMode, ThemeMode, WorkspaceRecord } from '../../shared/messages';
import { altShortcut, IS_MAC, modShortcut } from '../lib/platform';
import { topLevelFolders } from '../lib/tree';
import { Ico } from './Ico';
import { ACCENT_PRESETS, FolderPicker, ThemeCardPreview } from './settings';

interface OnboardingProps {
  settings: AppSettings;
  activeWorkspace: WorkspaceRecord | null;
  tree: BookmarkNode[];
  onPatch: (patch: Partial<AppSettings>) => void;
  onPatchWorkspace: (patch: Partial<WorkspaceRecord>) => void;
  onCreateWorkspace: (rootFolderId: string, name: string) => Promise<void>;
  onFinish: () => void;
}

interface FolderMultiPickerProps {
  tree: BookmarkNode[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}

function twoLevelFolders(tree: BookmarkNode[]): { id: string; title: string; depth: number }[] {
  const result: { id: string; title: string; depth: number }[] = [];
  for (const f of topLevelFolders(tree)) {
    result.push({ id: f.id, title: f.title, depth: 0 });
    if (f.children) {
      for (const child of f.children) {
        if (Array.isArray(child.children)) {
          result.push({ id: child.id, title: child.title, depth: 1 });
        }
      }
    }
  }
  return result;
}

function FolderMultiPicker({ tree, selectedIds, onToggle }: FolderMultiPickerProps) {
  const folders = twoLevelFolders(tree);
  return (
    <div style={{ display: 'grid', gap: 4, maxHeight: 240, overflowY: 'auto', paddingRight: 2 }}>
      {folders.map(f => {
        const active = selectedIds.includes(f.id);
        return (
          <button
            key={f.id}
            onClick={() => onToggle(f.id)}
            className="ff-card"
            style={{
              textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
              borderColor: active ? 'var(--accent)' : 'var(--line-1)',
              background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
              boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
              padding: '7px 12px',
              paddingLeft: 12 + f.depth * 18,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <Ico name="folder" size={f.depth === 0 ? 14 : 12} style={{ opacity: f.depth === 0 ? 1 : 0.7 }} />
            <span style={{ fontSize: f.depth === 0 ? 13 : 12, opacity: f.depth === 0 ? 1 : 0.85 }}>{f.title}</span>
            {active && <Ico name="check" size={13} style={{ marginLeft: 'auto', color: 'var(--accent)' }} />}
          </button>
        );
      })}
    </div>
  );
}

// Live preview of the workspace tab bar shown above the folder picker so users can
// see what "workspaces" actually look like before they finish onboarding.
function WorkspaceTabPreview({ folders }: { folders: { name: string; color: string }[] }) {
  if (folders.length === 0) return null;
  return (
    <div style={{
      display: 'flex', gap: 4, justifyContent: 'center', flexWrap: 'wrap',
      padding: '12px 16px', marginBottom: 12,
      background: 'var(--ink-1)', borderRadius: 10,
      border: '1px solid var(--line-1)',
    }}>
      {folders.map((f, i) => (
        <div key={`${f.name}-${i}`} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 8,
          background: i === 0 ? 'var(--ink-3)' : 'transparent',
          fontSize: 12, fontWeight: i === 0 ? 600 : 500,
          color: i === 0 ? f.color : 'var(--fg-2)',
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
          {f.name}
        </div>
      ))}
    </div>
  );
}

function ThemeChoiceCard({ id, label, hint, active, onSelect, preview }: {
  id: ThemeMode;
  label: string;
  hint: string;
  active: boolean;
  onSelect: (id: ThemeMode) => void;
  preview: 'light' | 'dark' | 'system';
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      className="ff-card"
      style={{
        textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
        borderColor: active ? 'var(--accent)' : 'var(--line-1)',
        background: active ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
        boxShadow: active ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
        padding: 16,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {active && <Ico name="check" size={14} style={{ color: 'var(--accent)' }} />}
      </div>
      {preview === 'system' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <ThemeCardPreview light />
          <ThemeCardPreview />
        </div>
      ) : (
        <ThemeCardPreview light={preview === 'light'} />
      )}
      <span style={{ fontSize: 12, color: 'var(--fg-3)' }}>{hint}</span>
    </button>
  );
}

export function Onboarding({ settings, activeWorkspace, tree, onPatch, onPatchWorkspace, onCreateWorkspace, onFinish }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [workspaceMode, setWorkspaceMode] = useState<'single' | 'multiple'>('single');
  const [selectedWorkspaceFolderIds, setSelectedWorkspaceFolderIds] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);

  const steps = [
    { title: "Welcome to Flipp's Favorites", desc: "A new-tab dashboard that uses your existing bookmarks. No imports. No accounts. Just a faster way to get where you're going." },
    { title: 'Choose your theme',           desc: 'Light, dark, or follow your system. You can change this any time in Settings.' },
    { title: 'Pick your accent',            desc: 'Pick the accent that feels right. You can change it any time in Settings.' },
    { title: 'Set up your workspace',       desc: 'Pick a root folder, or create multiple workspaces — each with its own layout and theme.' },
    { title: 'How should folders look?',    desc: 'Folders can stay compact as tiles, or always show inline as sections. You can change this any time.' },
    { title: "You're all set",              desc: 'Open Settings any time to tweak themes, layout, the dock and clock. Drag bookmarks to reorder. Right-click anywhere for context actions.' },
  ];
  const s = steps[step];

  // Resolve the preview-folders list each render so it stays in sync with the picker.
  const previewFolders: { name: string; color: string }[] = (() => {
    if (workspaceMode === 'single') {
      const folder = topLevelFolders(tree).find(f => f.id === activeWorkspace?.rootFolderId);
      const name = folder?.title ?? activeWorkspace?.name ?? 'Workspace';
      return [{ name, color: activeWorkspace?.accentColor ?? ACCENT_PRESETS[0].value }];
    }
    const folders = twoLevelFolders(tree);
    return selectedWorkspaceFolderIds
      .map(id => folders.find(f => f.id === id))
      .filter((f): f is { id: string; title: string; depth: number } => Boolean(f))
      .map((f, i) => ({ name: f.title, color: ACCENT_PRESETS[i % ACCENT_PRESETS.length].value }));
  })();

  const handleFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      if (workspaceMode === 'multiple' && selectedWorkspaceFolderIds.length > 0) {
        const folders = topLevelFolders(tree);
        for (const id of selectedWorkspaceFolderIds) {
          const folder = folders.find(f => f.id === id);
          if (folder) {
            await onCreateWorkspace(id, folder.title);
          }
        }
      }
    } catch {
      // workspace creation failed — proceed to finish anyway
    } finally {
      onFinish();
    }
  };

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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 16 }}>
              <ThemeChoiceCard id="light"  label="Light"  hint="Bright canvas, dark text."  active={settings.themeMode === 'light'}  onSelect={(id) => onPatch({ themeMode: id })} preview="light" />
              <ThemeChoiceCard id="dark"   label="Dark"   hint="Dim canvas, light text."    active={settings.themeMode === 'dark'}   onSelect={(id) => onPatch({ themeMode: id })} preview="dark" />
              <ThemeChoiceCard id="system" label="System" hint="Follow OS preference."      active={settings.themeMode === 'system'} onSelect={(id) => onPatch({ themeMode: id })} preview="system" />
            </div>
          )}

          {step === 2 && (
            <div className="ff-accents" style={{ margin: '24px auto', maxWidth: 420 }}>
              {ACCENT_PRESETS.map(a => (
                <button
                  key={a.id}
                  className="ff-accentchip"
                  data-active={(activeWorkspace?.accentColor ?? '').toUpperCase() === a.value.toUpperCase()}
                  onClick={() => onPatchWorkspace({ accentColor: a.value })}
                  style={{ background: a.value, color: a.value }}
                  aria-label={a.label}
                >
                  <span className="ff-accentchip__label">{a.label}</span>
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              <WorkspaceTabPreview folders={previewFolders} />
              <p style={{ fontSize: 12, color: 'var(--fg-3)', textAlign: 'center', margin: '0 0 4px' }}>
                Each workspace is a separate home screen with its own layout and accent color.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                <button
                  className="ff-card"
                  onClick={() => setWorkspaceMode('single')}
                  style={{
                    textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
                    borderColor: workspaceMode === 'single' ? 'var(--accent)' : 'var(--line-1)',
                    background: workspaceMode === 'single' ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
                    boxShadow: workspaceMode === 'single' ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Single workspace</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.45 }}>One collection. Pick your root folder below.</div>
                </button>
                <button
                  className="ff-card"
                  onClick={() => setWorkspaceMode('multiple')}
                  style={{
                    textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
                    borderColor: workspaceMode === 'multiple' ? 'var(--accent)' : 'var(--line-1)',
                    background: workspaceMode === 'multiple' ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))' : 'var(--ink-2)',
                    boxShadow: workspaceMode === 'multiple' ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)' : 'none',
                    padding: 14,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Multiple workspaces</div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.45 }}>Separate layouts per folder. Pick up to 5.</div>
                </button>
              </div>
              {workspaceMode === 'single' && (
                <div className="ff-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div className="ff-row__label">Root folder</div>
                    <div className="ff-row__hint">Your starting view. Change later in Settings.</div>
                  </div>
                  <FolderPicker
                    tree={tree}
                    value={activeWorkspace?.rootFolderId ?? ''}
                    onChange={(id) => onPatchWorkspace({ rootFolderId: id })}
                  />
                </div>
              )}
              {workspaceMode === 'multiple' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 8 }}>Select folders to use as workspaces:</div>
                  <FolderMultiPicker
                    tree={tree}
                    selectedIds={selectedWorkspaceFolderIds}
                    onToggle={id => setSelectedWorkspaceFolderIds(prev =>
                      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(0, 5)
                    )}
                  />
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
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
            </div>
          )}

          {step === 5 && (
            <div style={{ display: 'grid', placeItems: 'center', padding: '24px 0', fontSize: 13, color: 'var(--fg-3)' }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                {([
                  [modShortcut('K'),    'Search'],
                  ['Right-click',       'Edit & organize'],
                  ['Drag',              'Reorder bookmarks'],
                  [altShortcut('1-9'),  'Switch workspace'],
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
              {IS_MAC && (
                <p style={{ marginTop: 16, fontSize: 11, color: 'var(--fg-4)' }}>
                  Showing Mac shortcuts. Use ⌘ where Ctrl is shown on other platforms.
                </p>
              )}
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
              <button className="ff-btn" onClick={handleFinish} disabled={finishing}>
                <Ico name="check" size={14} /> Get started
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
