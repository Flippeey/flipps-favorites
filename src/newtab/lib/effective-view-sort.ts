import type { BookmarkSortMode, SortDirection, ViewMode, WorkspaceRecord } from '@/shared/messages';

// View + sort are now per-workspace (they live on WorkspaceRecord). When no
// workspace is active yet (first paint before workspaces load), fall back to the
// same defaults defaultWorkspaceSettings ships so the UI never renders undefined.
export interface EffectiveViewSort {
  folderMode: ViewMode;
  bookmarkSortMode: BookmarkSortMode;
  bookmarkSortDirection: SortDirection;
}

export function effectiveViewSort(activeWorkspace: WorkspaceRecord | null): EffectiveViewSort {
  return {
    folderMode: activeWorkspace?.folderMode ?? 'grid',
    bookmarkSortMode: activeWorkspace?.bookmarkSortMode ?? 'manual',
    bookmarkSortDirection: activeWorkspace?.bookmarkSortDirection ?? 'asc',
  };
}
