import { useCallback, useEffect, useRef } from 'react';
import type { AppSettings, WorkspaceRecord } from '@/shared/messages';
import type { MarqueeSelection } from '../interaction/useMarquee';
import { clearDropAttrs } from '../interaction/useDrag';
import { createWorkspace, deleteWorkspace, patchSettings, patchWorkspace } from '../lib/messaging';
import { defaultWorkspaceSettings, readWorkspaceWallpaper, writeWorkspaceWallpaper } from '@/shared/storage';
import { MAX_WORKSPACES } from '@/shared/constants';
import { pickNextAccent } from '../lib/workspace-accent';
import type { PushToastInput } from './useToasts';

export type CreateFromFolderGuardResult = 'proceed' | 'at_max' | 'already_exists';

/**
 * Guard checked before attempting to create a workspace from a folder: the cap
 * check and the duplicate-root check both short-circuit the actual create call.
 * Order matters — at_max is checked before already_exists (documented in
 * handleCreateWorkspaceFromFolder's caller-facing outcome contract).
 */
export function checkCreateFromFolderGuard(
  workspaces: Pick<WorkspaceRecord, 'rootFolderId'>[],
  folderId: string,
): CreateFromFolderGuardResult {
  if (workspaces.length >= MAX_WORKSPACES) return 'at_max';
  if (workspaces.some(w => w.rootFolderId === folderId)) return 'already_exists';
  return 'proceed';
}

interface UseWorkspaceActionsArgs {
  workspaces: WorkspaceRecord[];
  setWorkspaces: React.Dispatch<React.SetStateAction<WorkspaceRecord[]>>;
  activeWorkspace: WorkspaceRecord | null;
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setNewWorkspaceOpen: (open: boolean) => void;
  setWorkspaceWallpaper: (url: string) => void;
  setIsSwitching: (switching: boolean) => void;
  setFolderPath: React.Dispatch<React.SetStateAction<import('@/shared/messages').BookmarkNode[]>>;
  setSelection: React.Dispatch<React.SetStateAction<MarqueeSelection>>;
  handlePatch: (patch: Partial<AppSettings>) => Promise<void>;
  pushToast: (input: PushToastInput) => void;
  /** Reconciles local workspace state with persisted truth (e.g. after a patch fails). */
  refreshWorkspaces: () => Promise<void>;
}

interface UseWorkspaceActionsResult {
  handleSwitchWorkspace: (id: string) => Promise<void>;
  handlePatchWorkspace: (patch: Partial<WorkspaceRecord>) => Promise<void>;
  handleSetWorkspaceWallpaper: (dataUrl: string) => Promise<void>;
  handleCreateWorkspace: (
    rootFolderId: string,
    name: string,
    overrides?: Partial<Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'>>,
  ) => Promise<string | undefined>;
  handleCreateWorkspaceFromFolder: (folderId: string, folderTitle: string, insertIndex?: number) => Promise<'created' | 'at_max' | 'already_exists'>;
  handleDeleteWorkspace: (id: string) => Promise<void>;
  handleDuplicateWorkspace: (id: string) => Promise<void>;
  handleAddWorkspace: () => void;
  handleReorderWorkspaces: (ids: string[]) => Promise<void>;
  handleRenameWorkspace: (id: string, name: string) => Promise<void>;
}

export function useWorkspaceActions(args: UseWorkspaceActionsArgs): UseWorkspaceActionsResult {
  const {
    workspaces,
    setWorkspaces,
    activeWorkspace,
    settings,
    setSettings,
    setNewWorkspaceOpen,
    setWorkspaceWallpaper,
    setIsSwitching,
    setFolderPath,
    setSelection,
    handlePatch,
    pushToast,
    refreshWorkspaces,
  } = args;

  // Mirror the latest workspaces so sequential creates (onboarding bulk-create
  // awaits each call) see prior additions — the memoized callback's closure would
  // otherwise read a stale render-time snapshot and assign duplicate accents.
  const workspacesRef = useRef(workspaces);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);

  // Mirror the active workspace too, so a create triggered after a switch reads the
  // current density (not a stale render-time snapshot). handleCreateWorkspace's deps
  // intentionally exclude activeWorkspace to keep a stable identity for dialog props.
  const activeWorkspaceRef = useRef(activeWorkspace);
  useEffect(() => { activeWorkspaceRef.current = activeWorkspace; }, [activeWorkspace]);

  const handleSwitchWorkspace = useCallback(async (id: string) => {
    setIsSwitching(true);
    // Defensively wipe any stale drag-source / drop-indicator attributes so tiles
    // from the outgoing workspace don't render at reduced opacity in the new one.
    clearDropAttrs({ includeSource: true });
    await new Promise(r => setTimeout(r, 130));
    setFolderPath([]);
    setSelection({ ids: new Set(), scopeFolderId: '' });
    await handlePatch({ activeWorkspaceId: id });
    requestAnimationFrame(() => setIsSwitching(false));
  }, [handlePatch, setFolderPath, setIsSwitching, setSelection]);

  const handlePatchWorkspace = useCallback(async (patch: Partial<WorkspaceRecord>) => {
    if (!activeWorkspace) return;
    const workspaceId = activeWorkspace.id;
    setWorkspaces(prev => prev.map(w => w.id === workspaceId ? { ...w, ...patch } : w));
    try {
      const persisted = await patchWorkspace(workspaceId, patch);
      setWorkspaces(prev => prev.map(w => w.id === persisted.id ? persisted : w));
    } catch {
      // Persist failed — most commonly because the workspace was concurrently
      // deleted (e.g. from another newtab page). Keeping the optimistic value
      // would leave a ghost workspace in the UI until the next reload, so
      // surface the failure and reconcile with truth instead.
      pushToast({ kind: 'error', message: 'Couldn’t save workspace changes — it may have been deleted.' });
      await refreshWorkspaces();
    }
  }, [activeWorkspace, setWorkspaces, pushToast, refreshWorkspaces]);

  const handleSetWorkspaceWallpaper = useCallback(async (dataUrl: string) => {
    if (!activeWorkspace) return;
    setWorkspaceWallpaper(dataUrl);
    try {
      await writeWorkspaceWallpaper(activeWorkspace.id, dataUrl);
    } catch {
      // keep optimistic value
    }
  }, [activeWorkspace, setWorkspaceWallpaper]);

  const handleCreateWorkspace = useCallback(async (
    rootFolderId: string,
    name: string,
    overrides?: Partial<Omit<WorkspaceRecord, 'id' | 'name' | 'rootFolderId'>>,
    insertIndex?: number,
  ): Promise<string | undefined> => {
    // Read the live list (ref, not closure) so a sequential bulk-create loop sees
    // workspaces added by prior iterations before the next render.
    const current = workspacesRef.current;
    if (current.length >= MAX_WORKSPACES) return undefined;
    if (current.some(w => w.rootFolderId === rootFolderId)) return undefined;
    // Auto-pick an accent not used by existing workspaces for instant visual
    // differentiation. Sits between the defaults and the caller's overrides so an
    // explicit accentColor (e.g. the user's onboarding pick) still wins.
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      rootFolderId,
      ...defaultWorkspaceSettings,
      accentColor: pickNextAccent(current.map(w => w.accentColor)),
      // Density inherits the active workspace so a workspace made via the New
      // Workspace dialog matches what the user is currently looking at, rather than
      // snapping to the fixed 'balanced' default. Onboarding passes an explicit
      // layoutPreset override (resolution-aware) which still wins via the spread below.
      layoutPreset: activeWorkspaceRef.current?.layoutPreset ?? defaultWorkspaceSettings.layoutPreset,
      ...(overrides ?? {}),
    };
    try {
      const created = await createWorkspace(workspace);
      // Advance the ref synchronously so the next bulk-create iteration sees this
      // workspace (and its accent) before React re-renders.
      workspacesRef.current = [...workspacesRef.current, created];
      setWorkspaces(prev => [...prev, created]);
      // If an insertion index was specified, splice the new workspace into the order
      // at that position so it lands exactly where the user's drag indicator was.
      // Otherwise, fall back to appending (the new workspace appears at the end via
      // App.tsx's orderedWorkspaces logic, since it's not yet in workspaceOrder).
      const patch: Partial<AppSettings> = { activeWorkspaceId: created.id };
      if (insertIndex !== undefined) {
        const currentOrder = workspacesRef.current.map(w => w.id).filter(id => id !== created.id);
        const clampedIndex = Math.max(0, Math.min(insertIndex, currentOrder.length));
        const nextOrder = [
          ...currentOrder.slice(0, clampedIndex),
          created.id,
          ...currentOrder.slice(clampedIndex),
        ];
        patch.workspaceOrder = nextOrder;
      }
      await handlePatch(patch);
      return created.id;
    } catch {
      return undefined;
    }
  }, [handlePatch, setWorkspaces]);

  const handleDeleteWorkspace = useCallback(async (id: string) => {
    if (workspaces.length <= 1) return;
    try {
      await deleteWorkspace(id);
    } catch {
      return;
    }
    const remaining = workspaces.filter(w => w.id !== id);
    const nextActiveId = settings.activeWorkspaceId === id ? remaining[0]?.id : undefined;
    setWorkspaces(remaining);
    if (nextActiveId) await handlePatch({ activeWorkspaceId: nextActiveId });
  }, [workspaces, settings.activeWorkspaceId, handlePatch, setWorkspaces]);

  const handleDuplicateWorkspace = useCallback(async (id: string) => {
    if (workspaces.length >= MAX_WORKSPACES) return;
    const source = workspaces.find(w => w.id === id);
    if (!source) return;
    const duplicate: WorkspaceRecord = {
      ...source,
      id: crypto.randomUUID(),
      name: `Copy of ${source.name}`,
    };
    try {
      const created = await createWorkspace(duplicate);
      if (source.backgroundMode === 'wallpaper') {
        const wallpaper = await readWorkspaceWallpaper(source.id);
        if (wallpaper) await writeWorkspaceWallpaper(created.id, wallpaper);
      }
      setWorkspaces(prev => [...prev, created]);
      await handlePatch({ activeWorkspaceId: created.id });
    } catch {
      // creation failed — leave UI unchanged
    }
  }, [workspaces, handlePatch, setWorkspaces]);

  const handleCreateWorkspaceFromFolder = useCallback(async (
    folderId: string,
    folderTitle: string,
    insertIndex?: number,
  ): Promise<'created' | 'at_max' | 'already_exists'> => {
    const guard = checkCreateFromFolderGuard(workspacesRef.current, folderId);
    if (guard !== 'proceed') return guard;
    const created = await handleCreateWorkspace(folderId, folderTitle, undefined, insertIndex);
    return created !== undefined ? 'created' : 'at_max';
  }, [handleCreateWorkspace]);

  const handleAddWorkspace = useCallback(() => {
    setNewWorkspaceOpen(true);
  }, [setNewWorkspaceOpen]);

  const handleReorderWorkspaces = useCallback(async (ids: string[]) => {
    setSettings(prev => ({ ...prev, workspaceOrder: ids }));
    try { await patchSettings({ workspaceOrder: ids }); } catch { /* keep optimistic */ }
  }, [setSettings]);

  const handleRenameWorkspace = useCallback(async (id: string, name: string): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setWorkspaces(prev => prev.map(w => w.id === id ? { ...w, name: trimmed } : w));
    try {
      const next = await patchWorkspace(id, { name: trimmed });
      setWorkspaces(prev => prev.map(w => w.id === next.id ? next : w));
    } catch {
      // keep optimistic value
    }
  }, [setWorkspaces]);

  return {
    handleSwitchWorkspace,
    handlePatchWorkspace,
    handleSetWorkspaceWallpaper,
    handleCreateWorkspace,
    handleCreateWorkspaceFromFolder,
    handleDeleteWorkspace,
    handleDuplicateWorkspace,
    handleAddWorkspace,
    handleReorderWorkspaces,
    handleRenameWorkspace,
  };
}
