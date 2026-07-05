export const messageTypes = {
  ping: 'app/ping',
  getSettings: 'settings/get',
  patchSettings: 'settings/patch',
  openBookmarkManager: 'browser/open-bookmark-manager',
  getBookmarkTree: 'bookmarks/get-tree',
  createBookmark: 'bookmarks/create',
  moveBookmark: 'bookmarks/move',
  updateBookmark: 'bookmarks/update',
  removeBookmark: 'bookmarks/remove',
  getIcon: 'icons/get',
  searchIcons: 'icons/search',
  setIconOverride: 'icons/set-override',
  setIconOverrideFromUrl: 'icons/set-override-from-url',
  removeIconOverride: 'icons/remove-override',
  invalidateIcon: 'icons/invalidate',
  getBookmarkUsage: 'bookmarks/get-usage',
  recordBookmarkUse: 'bookmarks/record-use',
  getWorkspaces: 'workspaces/get-all',
  createWorkspace: 'workspaces/create',
  patchWorkspace: 'workspaces/patch',
  deleteWorkspace: 'workspaces/delete',
  openTab: 'tabs/open',
  syncPush: 'sync/push',
  syncPull: 'sync/pull',
  getSyncPairingCode: 'sync/get-pairing-code',
  adoptSyncSecret: 'sync/adopt-secret',
} as const;

// Domain models + unions now live in models.ts. Re-export so existing
// `import { … } from './messages'` call sites keep working unchanged.
export * from './models';
export type { IconOverrideScope } from './icon-scope';

import type {
  AppSettings,
  BookmarkNode,
  IconSearchCandidate,
  ResolvedIcon,
  WorkspaceRecord,
} from './models';
import type { IconOverrideScope } from './icon-scope';

export interface PingRequest {
  type: typeof messageTypes.ping;
}

export interface PingResponse {
  ok: true;
  context: 'background';
}

export interface GetSettingsRequest {
  type: typeof messageTypes.getSettings;
}

export interface GetSettingsResponse {
  settings: AppSettings;
}

export interface PatchSettingsRequest {
  type: typeof messageTypes.patchSettings;
  patch: Partial<AppSettings>;
}

export interface PatchSettingsResponse {
  settings: AppSettings;
}

export interface OpenBookmarkManagerRequest {
  type: typeof messageTypes.openBookmarkManager;
}

export interface OpenBookmarkManagerResponse {
  ok: boolean;
  opened: boolean;
  message?: string;
}

export interface GetBookmarkTreeRequest {
  type: typeof messageTypes.getBookmarkTree;
}

export interface GetBookmarkTreeResponse {
  tree: BookmarkNode[];
}

export interface CreateBookmarkRequest {
  type: typeof messageTypes.createBookmark;
  parentId: string;
  title: string;
  url?: string;
  index?: number;
}

export interface CreateBookmarkResponse {
  bookmark: BookmarkNode;
}

export interface MoveBookmarkRequest {
  type: typeof messageTypes.moveBookmark;
  bookmarkId: string;
  parentId: string;
  index?: number;
}

export interface MoveBookmarkResponse {
  bookmark: BookmarkNode;
}

export interface UpdateBookmarkRequest {
  type: typeof messageTypes.updateBookmark;
  bookmarkId: string;
  changes: {
    title?: string;
    url?: string;
  };
}

export interface UpdateBookmarkResponse {
  bookmark: BookmarkNode;
}

export interface RemoveBookmarkRequest {
  type: typeof messageTypes.removeBookmark;
  bookmarkId: string;
  recursive?: boolean;
}

export interface RemoveBookmarkResponse {
  ok: true;
}

export interface GetIconRequest {
  type: typeof messageTypes.getIcon;
  bookmarkUrl: string;
  bookmarkTitle?: string;
}

export interface GetIconResponse {
  icon: ResolvedIcon;
}

export interface SearchIconsRequest {
  type: typeof messageTypes.searchIcons;
  query: string;
  bookmarkUrl?: string;
}

export interface SearchIconsResponse {
  candidates: IconSearchCandidate[];
}

export interface SetIconOverrideRequest {
  type: typeof messageTypes.setIconOverride;
  bookmarkUrl: string;
  bookmarkTitle?: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  // How broadly the override applies. Absent (older callers) means 'exact'.
  scope?: IconOverrideScope;
}

export interface SetIconOverrideResponse {
  icon: ResolvedIcon;
}

export interface SetIconOverrideFromUrlRequest {
  type: typeof messageTypes.setIconOverrideFromUrl;
  bookmarkUrl: string;
  bookmarkTitle?: string;
  imageUrl: string;
  fallbackImageUrl?: string;
  fileName?: string;
  scope?: IconOverrideScope;
}

export interface SetIconOverrideFromUrlResponse {
  icon: ResolvedIcon;
}

export interface RemoveIconOverrideRequest {
  type: typeof messageTypes.removeIconOverride;
  bookmarkUrl: string;
  bookmarkTitle?: string;
}

export interface RemoveIconOverrideResponse {
  icon: ResolvedIcon;
}

export interface InvalidateIconRequest {
  type: typeof messageTypes.invalidateIcon;
  bookmarkUrl?: string;
}

export interface InvalidateIconResponse {
  ok: true;
}

export interface GetBookmarkUsageRequest {
  type: typeof messageTypes.getBookmarkUsage;
}

export interface GetBookmarkUsageResponse {
  usage: Record<string, number>;
}

export interface RecordBookmarkUseRequest {
  type: typeof messageTypes.recordBookmarkUse;
  bookmarkId: string;
}

export interface RecordBookmarkUseResponse {
  ok: true;
  usedAt: number;
}

export interface GetWorkspacesRequest {
  type: typeof messageTypes.getWorkspaces;
}

export interface GetWorkspacesResponse {
  workspaces: WorkspaceRecord[];
}

export interface CreateWorkspaceRequest {
  type: typeof messageTypes.createWorkspace;
  workspace: WorkspaceRecord;
}

export interface CreateWorkspaceResponse {
  workspace: WorkspaceRecord;
}

export interface PatchWorkspaceRequest {
  type: typeof messageTypes.patchWorkspace;
  id: string;
  patch: Partial<WorkspaceRecord>;
}

export interface PatchWorkspaceResponse {
  workspace: WorkspaceRecord;
}

export interface DeleteWorkspaceRequest {
  type: typeof messageTypes.deleteWorkspace;
  id: string;
}

export interface DeleteWorkspaceResponse {
  ok: true;
}

export interface OpenTabRequest {
  type: typeof messageTypes.openTab;
  url: string;
}

export interface OpenTabResponse {
  ok: true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings sync (#7). The export bundle carried by SyncPushRequest is the
// WorkspaceExportPayload built by newtab/lib/workspace-transfer.ts's
// buildWorkspaceExport() — typed here as `unknown` to avoid a messages.ts ->
// newtab import (messages.ts is shared/background-safe); callers narrow on
// their own side.
// ─────────────────────────────────────────────────────────────────────────────

export interface SyncPushRequest {
  type: typeof messageTypes.syncPush;
  bundle: unknown;
}

export interface SyncPushResponse {
  ok: true;
}

export interface SyncPullRequest {
  type: typeof messageTypes.syncPull;
}

export interface SyncPullResponse {
  found: true;
  payload: unknown;
}

export interface SyncPullNotFoundResponse {
  found: false;
}

export interface GetSyncPairingCodeRequest {
  type: typeof messageTypes.getSyncPairingCode;
}

export interface GetSyncPairingCodeResponse {
  pairingCode: string;
}

export interface AdoptSyncSecretRequest {
  type: typeof messageTypes.adoptSyncSecret;
  pairingCode: string;
}

export interface AdoptSyncSecretResponse {
  ok: true;
}

export type AppRequest =
  | PingRequest
  | GetSettingsRequest
  | PatchSettingsRequest
  | OpenBookmarkManagerRequest
  | GetBookmarkTreeRequest
  | CreateBookmarkRequest
  | MoveBookmarkRequest
  | UpdateBookmarkRequest
  | RemoveBookmarkRequest
  | GetIconRequest
  | SearchIconsRequest
  | SetIconOverrideRequest
  | SetIconOverrideFromUrlRequest
  | RemoveIconOverrideRequest
  | InvalidateIconRequest
  | GetBookmarkUsageRequest
  | RecordBookmarkUseRequest
  | GetWorkspacesRequest
  | CreateWorkspaceRequest
  | PatchWorkspaceRequest
  | DeleteWorkspaceRequest
  | OpenTabRequest
  | SyncPushRequest
  | SyncPullRequest
  | GetSyncPairingCodeRequest
  | AdoptSyncSecretRequest;

export type AppResponse =
  | PingResponse
  | GetSettingsResponse
  | PatchSettingsResponse
  | OpenBookmarkManagerResponse
  | GetBookmarkTreeResponse
  | CreateBookmarkResponse
  | MoveBookmarkResponse
  | UpdateBookmarkResponse
  | RemoveBookmarkResponse
  | GetIconResponse
  | SearchIconsResponse
  | SetIconOverrideResponse
  | SetIconOverrideFromUrlResponse
  | RemoveIconOverrideResponse
  | InvalidateIconResponse
  | GetBookmarkUsageResponse
  | RecordBookmarkUseResponse
  | GetWorkspacesResponse
  | CreateWorkspaceResponse
  | PatchWorkspaceResponse
  | DeleteWorkspaceResponse
  | OpenTabResponse
  | SyncPushResponse
  | (SyncPullResponse | SyncPullNotFoundResponse)
  | GetSyncPairingCodeResponse
  | AdoptSyncSecretResponse;
