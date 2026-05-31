import { useCallback } from 'react';
import type { AppSettings, WorkspaceRecord } from '@/shared/messages';
import type { MarqueeSelection } from '../interaction/useMarquee';
import { createWorkspace, deleteWorkspace, patchSettings, patchWorkspace } from '../lib/messaging';
import { defaultWorkspaceSettings, readWorkspaceWallpaper, writeWorkspaceWallpaper } from '@/shared/storage';
import { MAX_WORKSPACES } from '@/shared/constants';
import { runOptimistic } from './useOptimisticPatch';

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
  } = args;

  const handleSwitchWorkspace = useCallback(async (id: string) => {
    setIsSwitching(true);
    await new Promise(r => setTimeout(r, 130));
    setFolderPath([]);
    setSelection({ ids: new Set(), scopeFolderId: '' });
    await handlePatch({ activeWorkspaceId: id });
    requestAnimationFrame(() => setIsSwitching(false));
  }, [handlePatch, setFolderPath, setIsSwitching, setSelection]);

  const handlePatchWorkspace = useCallback(async (patch: Partial<WorkspaceRecord>) => {
    if (!activeWorkspace) return;
    await runOptimistic<WorkspaceRecord>({
      optimistic: { ...activeWorkspace, ...patch },
      apply: (ws) => setWorkspaces(prev => prev.map(w => w.id === ws.id ? ws : w)),
      persist: () => patchWorkspace(activeWorkspace.id, patch),
    });
  }, [activeWorkspace, setWorkspaces]);

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
  ): Promise<string | undefined> => {
    if (workspaces.length >= MAX_WORKSPACES) return undefined;
    if (workspaces.some(w => w.rootFolderId === rootFolderId)) return undefined;
    const workspace: WorkspaceRecord = {
      id: crypto.randomUUID(),
      name,
      rootFolderId,
      ...defaultWorkspaceSettings,
      ...(overrides ?? {}),
    };
    try {
      const created = await createWorkspace(workspace);
      setWorkspaces(prev => [...prev, created]);
      await handlePatch({ activeWorkspaceId: created.id });
      return created.id;
    } catch {
      return undefined;
    }
  }, [workspaces, handlePatch, setWorkspaces]);

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
    handleDeleteWorkspace,
    handleDuplicateWorkspace,
    handleAddWorkspace,
    handleReorderWorkspaces,
    handleRenameWorkspace,
  };
}
