import { useCallback, useMemo, useState } from 'react';
import { MAX_WORKSPACES } from '@/shared/constants';
import type { AppSettings, BookmarkNode, ThemeMode, WorkspaceRecord } from '@/shared/messages';
import type { ArchetypeId } from '@/shared/organization-templates';
import { ORGANIZATION_TEMPLATES } from '@/shared/organization-templates';
import { applyAccent } from '../lib/accent';
import { classify } from '../lib/archetype-match';
import { formatFolderStats, scanFolders, type ScoredFolder } from '../lib/folder-scoring';
import { recommendLayout, readViewportMetrics } from '../lib/layout-recommendation';
import { altShortcut, modShortcut } from '../lib/platform';
import { profileTree } from '../lib/tree-profile';
import { findFolder, topLevelFolders } from '../lib/tree';
import { Ico } from './Ico';
import { FolderMultiPicker } from './FolderMultiPicker';
import { ACCENT_PRESETS, ThemeCardPreview } from './settings';
import { TemplatePicker } from './TemplatePicker';

export interface OnboardingArchetypeResult {
  recommendedArchetype: ArchetypeId | null;
  chosenArchetype: ArchetypeId | 'skipped' | null;
}

interface OnboardingProps {
  settings: AppSettings;
  activeWorkspace: WorkspaceRecord | null;
  tree: BookmarkNode[];
  onPatch: (patch: Partial<AppSettings>) => void;
  onPatchWorkspace: (patch: Partial<WorkspaceRecord>) => Promise<void>;
  onCreateWorkspace: (rootFolderId: string, name: string, overrides?: Partial<WorkspaceRecord>) => Promise<string | undefined>;
  onFinish: (archetypeResult: OnboardingArchetypeResult) => void;
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

function RecommendedFolderCard({
  folder,
  active,
  onToggle,
}: {
  folder: ScoredFolder;
  active: boolean;
  onToggle: () => void;
}) {
  const statsLine = formatFolderStats(folder.stats);
  return (
    <button
      onClick={onToggle}
      className="ff-card"
      style={{
        textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'var(--fg-1)',
        borderColor: active ? 'var(--accent)' : 'var(--line-1)',
        background: active
          ? 'color-mix(in oklab, var(--accent) 7%, var(--ink-2))'
          : 'var(--ink-2)',
        boxShadow: active
          ? '0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)'
          : 'none',
        padding: '7px 12px',
        display: 'flex', alignItems: 'center', gap: 8,
      }}
    >
      <Ico name="folder" size={14} style={{ flexShrink: 0 }} />
      <span style={{
        fontSize: 13, fontWeight: 600, flex: '0 1 auto', minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{folder.title}</span>
      <span style={{
        fontSize: 12, color: 'var(--fg-3)', flex: '1 1 auto', minWidth: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{statsLine}</span>
      {active && <Ico name="check" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
    </button>
  );
}

export interface WorkspaceRecommendationsProps {
  tree: BookmarkNode[];
  preSelected: ScoredFolder[];
  suggested: ScoredFolder[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  excludeIds?: Set<string>;
  // 'full' (onboarding): lean into discovery — up to 5 recommendations and the
  // tree opens to the current selection. 'compact' (add-to-existing dashboard):
  // a tighter shortlist of 3 and a collapsed tree, so the dialog stays short.
  variant?: 'full' | 'compact';
}

// How many ranked folders to pin above the tree per variant. preSelected (max 3
// from scanFolders) is topped up with the best suggested folders to reach the cap.
const RECOMMENDATION_CAP: Record<'full' | 'compact', number> = { full: 5, compact: 3 };

// Labelled rule separating the pinned recommendations from the full folder tree.
function FolderSectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 8px' }}>
      <span style={{
        fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
        textTransform: 'uppercase', color: 'var(--fg-3)', flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: 'var(--line-1)' }} />
    </div>
  );
}

// One continuous picker surface: a few ranked recommendations pinned on top,
// then the full expand/collapse tree. The recommendations are a shortcut; the
// tree remains the source of truth, so a folder selected in either lights up in
// both. No mode switch, no height-shifting disclosure. Scrolling is owned by the
// surrounding dialog/onboarding body — the picker stays unbounded so there is
// never a second nested scrollbar.
export function WorkspaceRecommendations({
  tree, preSelected, suggested, selectedIds, onToggle, excludeIds, variant = 'full',
}: WorkspaceRecommendationsProps) {
  const recommendations = [...preSelected, ...suggested].slice(0, RECOMMENDATION_CAP[variant]);

  return (
    <div>
      {recommendations.length > 0 && (
        <>
          <FolderSectionDivider label="Recommended" />
          <div style={{ display: 'grid', gap: 4, marginBottom: 14 }}>
            {recommendations.map(f => (
              <RecommendedFolderCard
                key={f.id}
                folder={f}
                active={selectedIds.includes(f.id)}
                onToggle={() => onToggle(f.id)}
              />
            ))}
          </div>
          <FolderSectionDivider label="All folders" />
        </>
      )}
      <FolderMultiPicker
        tree={tree}
        selectedIds={selectedIds}
        onToggle={onToggle}
        excludeIds={excludeIds}
        embedded
        autoExpand={variant === 'full'}
      />
    </div>
  );
}

const TIPS: { headline: string; body: string; icon: string }[] = [
  {
    headline: 'Right-click for everything',
    body: 'Right-click any bookmark, folder, or empty space to edit, move, delete, or add new items.',
    icon: 'moreVertical',
  },
  {
    headline: 'Search across everything',
    body: `Press S or ${modShortcut('K')} to search all your bookmarks and folders across every workspace.`,
    icon: 'search',
  },
  {
    headline: 'Make each workspace yours',
    body: 'Each workspace has its own theme, accent, background, and layout. Click Customize to personalize.',
    icon: 'palette',
  },
  {
    headline: 'Add and edit bookmarks',
    body: 'Press A to add a bookmark, or use the + button. Change any title, URL, or icon after adding.',
    icon: 'plus',
  },
  {
    headline: 'Switch workspaces fast',
    body: `Click tabs at the top, or press ${altShortcut('1')}–${altShortcut('9')} to jump with the keyboard.`,
    icon: 'layers',
  },
  {
    headline: 'Sort your way',
    body: 'Use the sort dropdown to arrange by name, date, or last used — or switch to Manual and drag to reorder.',
    icon: 'sort',
  },
];

function TipsCarousel() {
  const [tipIdx, setTipIdx] = useState(0);
  const [tipDir, setTipDir] = useState<'forward' | 'back'>('forward');
  const tip = TIPS[tipIdx];

  return (
    <div style={{ padding: '12px 0' }}>
      <div className="ff-onboard__tips">
        <button
          className="ff-iconbtn ff-iconbtn--icon"
          onClick={() => { setTipDir('back'); setTipIdx(i => Math.max(0, i - 1)); }}
          disabled={tipIdx === 0}
          aria-label="Previous tip"
        >
          <Ico name="chevronLeft" size={16} />
        </button>

        <div className="ff-onboard__tip" key={tipIdx} data-dir={tipDir}>
          <div className="ff-onboard__tip-icon">
            <Ico name={tip.icon} size={20} />
          </div>
          <div className="ff-onboard__tip-headline">{tip.headline}</div>
          <div className="ff-onboard__tip-body">{tip.body}</div>
        </div>

        <button
          className="ff-iconbtn ff-iconbtn--icon"
          onClick={() => { setTipDir('forward'); setTipIdx(i => Math.min(TIPS.length - 1, i + 1)); }}
          disabled={tipIdx === TIPS.length - 1}
          aria-label="Next tip"
        >
          <Ico name="chevronRight" size={16} />
        </button>
      </div>

      <div className="ff-onboard__tip-dots">
        {TIPS.map((_, i) => (
          <button
            key={i}
            className="ff-onboard__tip-dot"
            data-active={i === tipIdx}
            onClick={() => { setTipDir(i > tipIdx ? 'forward' : 'back'); setTipIdx(i); }}
            aria-label={`Tip ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}

export function Onboarding({ settings, activeWorkspace, tree, onPatch, onPatchWorkspace, onCreateWorkspace, onFinish }: OnboardingProps) {
  const scanResult = useMemo(() => scanFolders(tree), [tree]);

  // Resolution-aware default for NEW installs: pick a layout preset that fits the
  // current window/screen so small laptops don't get oversized tiles and big/4K
  // monitors aren't sparse. Computed once at onboarding start (empty deps) — this
  // is an initial default, not a live re-layout on resize.
  const recommendedLayout = useMemo(() => recommendLayout(readViewportMetrics()), []);

  const [step, setStep] = useState(0);
  // Seed at least one folder so the default state is valid; the user can change it.
  const [selectedWorkspaceFolderIds, setSelectedWorkspaceFolderIds] = useState<string[]>(() => {
    if (scanResult.preSelected.length) return scanResult.preSelected.map(f => f.id);
    const fallback = activeWorkspace?.rootFolderId ?? topLevelFolders(tree)[0]?.id;
    return fallback ? [fallback] : [];
  });
  const [pendingAccentColor, setPendingAccentColor] = useState(
    activeWorkspace?.accentColor ?? ACCENT_PRESETS[0].value,
  );

  // Template picker: classify the selected workspace folders' content profile.
  // Recompute whenever the folder selection changes (mirrors scanFolders memo).
  const archetypeMatch = useMemo(() => {
    const roots = selectedWorkspaceFolderIds
      .map(id => findFolder(tree, id))
      .filter((n): n is NonNullable<typeof n> => n !== null);
    const profile = profileTree(roots);
    return classify(profile);
  }, [selectedWorkspaceFolderIds, tree]);

  // Which template the user has chosen. Null = not yet chosen / skip.
  // When the classifier has a recommendation, preselect it as default.
  const [pendingTemplateId, setPendingTemplateId] = useState<ArchetypeId | null>(() =>
    archetypeMatch.archetype,
  );

  // When the classifier recommends an archetype, mirror its folderMode as the
  // default view-mode so the two controls stay in sync on first load.
  // This runs only once at mount (archetypeMatch.archetype is stable for the
  // initial selection); the user can always override via the explicit toggle.
  // We don't use an effect here — initial state derivation is enough.

  const [finishing, setFinishing] = useState(false);
  const [closing, setClosing] = useState(false);

  const handleClose = useCallback((archetypeResult?: OnboardingArchetypeResult) => {
    if (closing) return;
    setClosing(true);
    // Skip path: archetypeResult not provided → user dismissed without completing.
    const result: OnboardingArchetypeResult = archetypeResult ?? {
      recommendedArchetype: archetypeMatch.archetype,
      chosenArchetype: 'skipped',
    };
    setTimeout(() => onFinish(result), 200);
  }, [closing, onFinish, archetypeMatch.archetype]);

  const hasRecommendations = scanResult.preSelected.length > 0 || scanResult.suggested.length > 0;
  const workspaceStepDesc = hasRecommendations
    ? 'Pick one or more folders to start with — each becomes its own workspace. Adjust the selection or browse all folders.'
    : 'Pick one or more folders to start with — each becomes its own workspace.';

  const steps = [
    { title: "Welcome to Flipp's Favorites", desc: '' },
    { title: 'Choose your initial appearance', desc: 'Pick a starting theme and accent color for this workspace.' },
    { title: 'Choose your workspaces',       desc: workspaceStepDesc },
    { title: 'Pick a starting preset', desc: 'Just a starting point to get you going — choose the one closest to how you use bookmarks. You can change everything later.' },
    { title: "You're all set — here are a few tips", desc: 'A few things that will make your experience even better.' },
  ];
  const s = steps[step];

  const handleFinish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      // Onboarding theme/accent picks only persist to an existing workspace via
      // onPatchWorkspace. On a fresh install the workspace is created here, so carry the
      // chosen accent + theme through as overrides — otherwise they reset to the defaults.
      // Only the first workspace honors the user's explicit accent pick; bulk-created
      // siblings auto-pick a distinct unused accent (handled in handleCreateWorkspace).
      // layoutPreset is a resolution-aware default applied to every workspace created
      // here (fresh install / new selections via onCreateWorkspace). The activeWorkspace
      // retarget branch below never spreads these overrides, so an existing workspace's
      // user-chosen accent + layout are left untouched.
      const layoutPreset = recommendedLayout.layoutPreset;

      // Template overrides: spread the chosen template's workspaceOverrides (folderMode,
      // bookmarkSortMode, bookmarkSortDirection) into every workspace created here.
      // The chosen preset is the sole source of the workspace view/sort — there is no
      // separate view-mode control to compose against.
      // Template NEVER sets layoutPreset — layout-recommendation.ts owns that field.
      const templateOverrides = pendingTemplateId
        ? { ...ORGANIZATION_TEMPLATES[pendingTemplateId].workspaceOverrides }
        : {};

      const firstOverrides = {
        accentColor: pendingAccentColor,
        themeMode: settings.themeMode,
        layoutPreset,
        ...templateOverrides,
      };
      const restOverrides = {
        themeMode: settings.themeMode,
        layoutPreset,
        ...templateOverrides,
      };

      const [firstId, ...restIds] = selectedWorkspaceFolderIds;
      if (activeWorkspace) {
        // Re-run over existing workspaces.
        //
        // NEVER retarget an existing workspace's rootFolderId here. Doing so used to
        // corrupt the ACTIVE workspace (repointing it at firstId's folder) and orphan
        // its old root — which the create-if-missing loop below then recreated as a
        // DUPLICATE workspace (the "last workspace duplicated" bug). Instead:
        //   1. Apply the chosen preset (opt-in) to the active workspace IN PLACE. This
        //      is the explicit opt-in control — we only patch view/sort when the user
        //      actually picked a preset on this re-run.
        //   2. Create workspaces only for selected folders that don't already have one
        //      (handleCreateWorkspace dedups by rootFolderId, so existing ones are skipped).
        if (pendingTemplateId) {
          await onPatchWorkspace({
            folderMode: templateOverrides.folderMode,
            bookmarkSortMode: templateOverrides.bookmarkSortMode,
            bookmarkSortDirection: templateOverrides.bookmarkSortDirection,
          });
        }
        for (const id of selectedWorkspaceFolderIds) {
          const folder = findFolder(tree, id);
          if (folder) await onCreateWorkspace(id, folder.title, restOverrides);
        }
      } else if (firstId) {
        // Fresh install: create every selected folder as a workspace. The first honors
        // the user's explicit accent pick; siblings auto-pick a distinct accent.
        const folder = findFolder(tree, firstId);
        await onCreateWorkspace(firstId, folder?.title ?? 'My workspace', firstOverrides);
        for (const id of restIds) {
          const restFolder = findFolder(tree, id);
          if (restFolder) await onCreateWorkspace(id, restFolder.title, restOverrides);
        }
      }
    } catch {
      // workspace creation failed — proceed to finish anyway
    } finally {
      handleClose({
        recommendedArchetype: archetypeMatch.archetype,
        chosenArchetype: pendingTemplateId ?? 'skipped',
      });
    }
  };

  const handleSkip = async () => {
    if (finishing || closing) return;
    setFinishing(true);
    try {
      // Fresh install (no workspace yet): skipping must still leave the user with a
      // usable default workspace. Without one, workspace-scoped settings (view mode,
      // sort mode) have nowhere to persist and can't be changed. Use the bookmark-bar
      // root (first top-level folder) so the workspace holds all folders/bookmarks.
      // Replay (activeWorkspace present) skips creation — handleCreateWorkspace also
      // dedups by rootFolderId, so this never adds a duplicate.
      if (!activeWorkspace) {
        const rootFolderId = topLevelFolders(tree)[0]?.id;
        if (rootFolderId) await onCreateWorkspace(rootFolderId, 'Favorites');
      }
    } catch {
      // workspace creation failed — close anyway
    } finally {
      handleClose();
    }
  };

  return (
    <div className="ff-modal-scrim" data-closing={closing || undefined}>
      <div className="ff-onboard" data-closing={closing || undefined} onClick={(e) => e.stopPropagation()}>
        <div className="ff-onboard__hero">
          <div className="ff-onboard__steps" aria-label={`Step ${step + 1} of ${steps.length}`}>
            {steps.map((_, i) => (
              <div key={i} className="ff-onboard__step" data-active={i <= step} />
            ))}
          </div>
          <h2 className="ff-onboard__title">{s.title}</h2>
          {s.desc && <p className="ff-onboard__desc">{s.desc}</p>}
        </div>
        <div className="ff-onboard__body">
          {step === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: '20px 0' }}>
              <div style={{
                flexShrink: 0,
                width: 88, height: 88, borderRadius: 20,
                background: 'linear-gradient(180deg, #2A2826, #0A0908)',
                border: '1px solid var(--line-2)',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gridTemplateRows: 'repeat(4, 1fr)',
                gap: 4, padding: 9,
                boxShadow: '0 16px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
              }}>
                {['#FF7A2B','#FFD479','#FF6B6B','#C96A7D','#7D60D8','#3F72DC','#23867B','#7BAE2C','#2F8F4E','#FFB454','#F1641E','#E94235','#1ABCFE','#60A5FA','#C85FA4','#FFB380'].map((c, i) => (
                  <div key={i} style={{ background: c, borderRadius: 3 }} />
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-1)', lineHeight: 1.6, fontWeight: 500 }}>
                  We'll guide you through a few quick choices to get you set up. It will only take a minute!
                </p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.5 }}>
                  Any setting you configure here can be changed later from Settings.
                </p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 16 }}>
              <div>
                <FolderSectionDivider label="Theme" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  <ThemeChoiceCard id="system" label="System" hint="Follow OS preference."      active={settings.themeMode === 'system'} onSelect={(id) => { onPatch({ themeMode: id }); void onPatchWorkspace({ themeMode: id }); }} preview="system" />
                  <ThemeChoiceCard id="light"  label="Light"  hint="Bright canvas, dark text."  active={settings.themeMode === 'light'}  onSelect={(id) => { onPatch({ themeMode: id }); void onPatchWorkspace({ themeMode: id }); }} preview="light" />
                  <ThemeChoiceCard id="dark"   label="Dark"   hint="Dim canvas, light text."    active={settings.themeMode === 'dark'}   onSelect={(id) => { onPatch({ themeMode: id }); void onPatchWorkspace({ themeMode: id }); }} preview="dark" />
                </div>
              </div>
              <div>
                <FolderSectionDivider label="Accent" />
                <div className="ff-accents" style={{ maxWidth: 420 }}>
                  {ACCENT_PRESETS.map(a => (
                    <button
                      key={a.id}
                      className="ff-accentchip"
                      data-active={pendingAccentColor.toUpperCase() === a.value.toUpperCase()}
                      onClick={() => {
                        setPendingAccentColor(a.value);
                        // Live preview: applyAccent writes the CSS vars immediately. On a fresh
                        // install there is no workspace yet, so onPatchWorkspace would no-op and
                        // App's accent effect never fires — drive the preview directly here.
                        applyAccent(a.value);
                        if (activeWorkspace) void onPatchWorkspace({ accentColor: a.value });
                      }}
                      style={{ background: a.value, color: a.value }}
                      aria-label={a.label}
                    >
                      <span className="ff-accentchip__label">{a.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
              <WorkspaceRecommendations
                tree={tree}
                preSelected={scanResult.preSelected}
                suggested={scanResult.suggested}
                selectedIds={selectedWorkspaceFolderIds}
                onToggle={id => setSelectedWorkspaceFolderIds(prev =>
                  prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id].slice(0, MAX_WORKSPACES),
                )}
              />
            </div>
          )}

          {step === 3 && (
            <TemplatePicker
              match={archetypeMatch}
              selectedId={pendingTemplateId}
              onSelect={setPendingTemplateId}
            />
          )}

          {step === 4 && <TipsCarousel />}
        </div>
        <footer className="ff-onboard__foot">
          <button className="ff-iconbtn" onClick={handleSkip}>Skip</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && (
              <button className="ff-btn ff-btn--ghost" onClick={() => setStep(step - 1)}>
                <Ico name="chevronLeft" size={14} /> Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button
                className="ff-btn"
                onClick={() => setStep(step + 1)}
                disabled={step === 2 && selectedWorkspaceFolderIds.length === 0}
                title={step === 2 && selectedWorkspaceFolderIds.length === 0 ? 'Pick at least one folder to continue' : undefined}
              >
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
