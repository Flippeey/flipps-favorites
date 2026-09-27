/**
 * buildOnboardingPlan — pure planning logic extracted from Onboarding.tsx's
 * handleFinish.
 *
 * WHY these cases matter:
 *  - Fresh install vs re-run take genuinely different paths (create vs patch
 *    + create), and only the fresh-install first workspace gets the user's
 *    explicit accent pick / a 'My workspace' name fallback.
 *  - Re-run over an existing workspace must NEVER retarget its rootFolderId —
 *    doing so used to corrupt the active workspace and orphan its old root,
 *    which the create-if-missing loop then recreated as a duplicate (the
 *    "last workspace duplicated" bug). These tests assert the re-run plan
 *    only ever patches the active workspace in place and creates workspaces
 *    for OTHER selected folders — it never emits a step that would repoint
 *    the active workspace's own root.
 *  - Each template's workspaceOverrides must reach both the patch step (for
 *    the active workspace) and every createWorkspace step's overrides.
 */
import { describe, expect, it } from 'vitest';
import { ORGANIZATION_TEMPLATES } from '@/shared/organization-templates';
import { buildOnboardingPlan, type OnboardingPlanInput } from '@/newtab/lib/onboarding-plan';

const baseInput: OnboardingPlanInput = {
  hasActiveWorkspace: false,
  pendingTemplateId: null,
  selectedWorkspaceFolderIds: [],
  folderTitles: {},
  accentColor: '#FF7A2B',
  themeMode: 'dark',
  layoutPreset: 'balanced',
};

describe('buildOnboardingPlan — fresh install (no active workspace)', () => {
  it('creates a single workspace for a single selected folder, with the explicit accent pick', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      selectedWorkspaceFolderIds: ['f1'],
      folderTitles: { f1: 'Reading' },
    });
    expect(plan).toEqual([
      {
        kind: 'createWorkspace',
        folderId: 'f1',
        name: 'Reading',
        overrides: { accentColor: '#FF7A2B', themeMode: 'dark', layoutPreset: 'balanced' },
      },
    ]);
  });

  it('falls back to "My workspace" as the first workspace name when its folder was not found in the tree', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      selectedWorkspaceFolderIds: ['missing'],
      folderTitles: {},
    });
    expect(plan).toEqual([
      {
        kind: 'createWorkspace',
        folderId: 'missing',
        name: 'My workspace',
        overrides: { accentColor: '#FF7A2B', themeMode: 'dark', layoutPreset: 'balanced' },
      },
    ]);
  });

  it('creates one workspace per selected folder (N folders): only the first carries the accent override', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      selectedWorkspaceFolderIds: ['f1', 'f2', 'f3'],
      folderTitles: { f1: 'A', f2: 'B', f3: 'C' },
    });
    expect(plan).toEqual([
      { kind: 'createWorkspace', folderId: 'f1', name: 'A', overrides: { accentColor: '#FF7A2B', themeMode: 'dark', layoutPreset: 'balanced' } },
      { kind: 'createWorkspace', folderId: 'f2', name: 'B', overrides: { themeMode: 'dark', layoutPreset: 'balanced' } },
      { kind: 'createWorkspace', folderId: 'f3', name: 'C', overrides: { themeMode: 'dark', layoutPreset: 'balanced' } },
    ]);
  });

  it('skips a later selected folder whose title was not found (unlike the first, which falls back instead)', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      selectedWorkspaceFolderIds: ['f1', 'missing', 'f3'],
      folderTitles: { f1: 'A', f3: 'C' },
    });
    expect(plan.map(s => (s.kind === 'createWorkspace' ? s.folderId : s.kind))).toEqual(['f1', 'f3']);
  });

  it('produces an empty plan when no folder is selected', () => {
    expect(buildOnboardingPlan(baseInput)).toEqual([]);
  });

  it('produces an empty plan when no folder is selected, even with a template chosen', () => {
    expect(buildOnboardingPlan({ ...baseInput, pendingTemplateId: 'casual' })).toEqual([]);
  });
});

describe('buildOnboardingPlan — re-run over an existing workspace', () => {
  it('never emits a step that would retarget the active workspace\'s own rootFolderId (the "last workspace duplicated" bug)', () => {
    // Re-running onboarding must only patch the active workspace in place and
    // create workspaces for the OTHER selected folders — nothing in the plan
    // shape lets a createWorkspace step stand in for the active workspace.
    const plan = buildOnboardingPlan({
      ...baseInput,
      hasActiveWorkspace: true,
      pendingTemplateId: 'power-user',
      selectedWorkspaceFolderIds: ['f1', 'f2'],
      folderTitles: { f1: 'A', f2: 'B' },
    });
    expect(plan[0]).toEqual({ kind: 'patchActiveWorkspace', patch: ORGANIZATION_TEMPLATES['power-user'].workspaceOverrides });
    // Both selected folders are plain creates (dedup against an existing
    // workspace root happens downstream in onCreateWorkspace) — none of them
    // carries accentColor, which only ever applies to a fresh-install first
    // workspace, never to a re-run.
    expect(plan.slice(1)).toEqual([
      { kind: 'createWorkspace', folderId: 'f1', name: 'A', overrides: { themeMode: 'dark', layoutPreset: 'balanced', ...ORGANIZATION_TEMPLATES['power-user'].workspaceOverrides } },
      { kind: 'createWorkspace', folderId: 'f2', name: 'B', overrides: { themeMode: 'dark', layoutPreset: 'balanced', ...ORGANIZATION_TEMPLATES['power-user'].workspaceOverrides } },
    ]);
  });

  it('patches the active workspace even when no folder is newly selected', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      hasActiveWorkspace: true,
      pendingTemplateId: 'hoarder',
      selectedWorkspaceFolderIds: [],
    });
    expect(plan).toEqual([{ kind: 'patchActiveWorkspace', patch: ORGANIZATION_TEMPLATES.hoarder.workspaceOverrides }]);
  });

  it('skips a selected folder whose title was not found — no fallback name on a re-run', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      hasActiveWorkspace: true,
      selectedWorkspaceFolderIds: ['missing'],
      folderTitles: {},
    });
    expect(plan).toEqual([]);
  });
});

describe('buildOnboardingPlan — no template chosen', () => {
  it('emits no patch step on a re-run when the user picked no template', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      hasActiveWorkspace: true,
      pendingTemplateId: null,
      selectedWorkspaceFolderIds: ['f1'],
      folderTitles: { f1: 'A' },
    });
    expect(plan).toEqual([
      { kind: 'createWorkspace', folderId: 'f1', name: 'A', overrides: { themeMode: 'dark', layoutPreset: 'balanced' } },
    ]);
  });

  it('creates fresh-install workspaces with no view/sort overrides beyond theme + layout', () => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      pendingTemplateId: null,
      selectedWorkspaceFolderIds: ['f1'],
      folderTitles: { f1: 'A' },
    });
    expect(plan).toEqual([
      { kind: 'createWorkspace', folderId: 'f1', name: 'A', overrides: { accentColor: '#FF7A2B', themeMode: 'dark', layoutPreset: 'balanced' } },
    ]);
  });
});

describe('buildOnboardingPlan — each template\'s view/sort overrides reach the right workspaces', () => {
  const archetypes = Object.keys(ORGANIZATION_TEMPLATES) as (keyof typeof ORGANIZATION_TEMPLATES)[];

  it.each(archetypes)('fresh install: %s template overrides land on every created workspace', (id) => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      pendingTemplateId: id,
      selectedWorkspaceFolderIds: ['f1', 'f2'],
      folderTitles: { f1: 'A', f2: 'B' },
    });
    const overrides = ORGANIZATION_TEMPLATES[id].workspaceOverrides;
    for (const step of plan) {
      expect(step.kind).toBe('createWorkspace');
      if (step.kind === 'createWorkspace') {
        expect(step.overrides).toMatchObject(overrides);
      }
    }
  });

  it.each(archetypes)('re-run: %s template patches the active workspace with exactly its workspaceOverrides', (id) => {
    const plan = buildOnboardingPlan({
      ...baseInput,
      hasActiveWorkspace: true,
      pendingTemplateId: id,
      selectedWorkspaceFolderIds: [],
    });
    expect(plan).toEqual([{ kind: 'patchActiveWorkspace', patch: ORGANIZATION_TEMPLATES[id].workspaceOverrides }]);
  });
});
