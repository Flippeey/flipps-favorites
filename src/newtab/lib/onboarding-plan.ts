// Pure planning logic extracted from Onboarding.tsx's handleFinish: given the
// user's choices, returns an explicit, ordered list of workspace mutations to
// perform. handleFinish executes the plan with the same onPatchWorkspace /
// onCreateWorkspace calls, in the same order — this module makes no calls
// itself and touches no storage.
import type { LayoutPresetId, ThemeMode, WorkspaceRecord } from '@/shared/messages';
import type { ArchetypeId } from '@/shared/organization-templates';
import { ORGANIZATION_TEMPLATES } from '@/shared/organization-templates';

export type OnboardingPlanStep =
  | {
      kind: 'patchActiveWorkspace';
      patch: Partial<Pick<WorkspaceRecord, 'folderMode' | 'bookmarkSortMode' | 'bookmarkSortDirection'>>;
    }
  | {
      kind: 'createWorkspace';
      folderId: string;
      name: string;
      overrides: Partial<WorkspaceRecord>;
    };

export interface OnboardingPlanInput {
  // Whether onboarding is re-running over an existing workspace (vs a fresh
  // install with none yet) — only presence matters, no field is read from it.
  hasActiveWorkspace: boolean;
  pendingTemplateId: ArchetypeId | null;
  selectedWorkspaceFolderIds: string[];
  // Folder title for every id in selectedWorkspaceFolderIds that resolves to
  // a real folder in the live tree (mirrors findFolder(tree, id)?.title).
  // An id with no entry here means the folder wasn't found.
  folderTitles: Record<string, string>;
  accentColor: string;
  themeMode: ThemeMode;
  layoutPreset: LayoutPresetId;
}

// Re-run over an existing workspace never retargets its rootFolderId — doing
// so used to corrupt the active workspace and orphan its old root, which the
// create-if-missing loop then recreated as a duplicate ("last workspace
// duplicated" bug). Instead the active workspace is patched in place (opt-in:
// only when the user picked a template on this run) and new workspaces are
// created only for selected folders that don't already have one —
// onCreateWorkspace dedups by rootFolderId, so already-existing ones are
// skipped downstream.
export function buildOnboardingPlan(input: OnboardingPlanInput): OnboardingPlanStep[] {
  const templateOverrides = input.pendingTemplateId
    ? { ...ORGANIZATION_TEMPLATES[input.pendingTemplateId].workspaceOverrides }
    : {};

  // layoutPreset is a resolution-aware default applied to every workspace
  // created here. Only the first workspace on a fresh install honors the
  // user's explicit accent pick; every other created workspace (including
  // all of them on a re-run) auto-picks its own accent downstream.
  const firstOverrides: Partial<WorkspaceRecord> = {
    accentColor: input.accentColor,
    themeMode: input.themeMode,
    layoutPreset: input.layoutPreset,
    ...templateOverrides,
  };
  const restOverrides: Partial<WorkspaceRecord> = {
    themeMode: input.themeMode,
    layoutPreset: input.layoutPreset,
    ...templateOverrides,
  };

  const steps: OnboardingPlanStep[] = [];

  if (input.hasActiveWorkspace) {
    if (input.pendingTemplateId) {
      steps.push({
        kind: 'patchActiveWorkspace',
        patch: {
          folderMode: templateOverrides.folderMode,
          bookmarkSortMode: templateOverrides.bookmarkSortMode,
          bookmarkSortDirection: templateOverrides.bookmarkSortDirection,
        },
      });
    }
    for (const id of input.selectedWorkspaceFolderIds) {
      const title = input.folderTitles[id];
      if (title !== undefined) {
        steps.push({ kind: 'createWorkspace', folderId: id, name: title, overrides: restOverrides });
      }
    }
    return steps;
  }

  const [firstId, ...restIds] = input.selectedWorkspaceFolderIds;
  if (firstId) {
    // Fresh install: the first workspace is always created, falling back to a
    // generic name if the folder somehow isn't found — every subsequent one
    // is skipped instead when its folder isn't found.
    const firstTitle = input.folderTitles[firstId] ?? 'My workspace';
    steps.push({ kind: 'createWorkspace', folderId: firstId, name: firstTitle, overrides: firstOverrides });
    for (const id of restIds) {
      const title = input.folderTitles[id];
      if (title !== undefined) {
        steps.push({ kind: 'createWorkspace', folderId: id, name: title, overrides: restOverrides });
      }
    }
  }
  return steps;
}
