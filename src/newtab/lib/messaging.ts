import { extensionApi } from '@/shared/browser';
import type {
  AppErrorResponse,
  AppRequest,
  AppResponse,
  AppSettings,
  BookmarkNode,
  GetBookmarkTreeResponse,
  GetIconResponse,
  GetSettingsResponse,
  IconSearchCandidate,
  InvalidateIconResponse,
  PatchSettingsResponse,
  RemoveIconOverrideResponse,
  ResolvedIcon,
  SearchIconsResponse,
  SetIconOverrideFromUrlResponse,
  SetIconOverrideResponse,
  UpdateBookmarkResponse,
  CreateBookmarkResponse,
  RemoveBookmarkResponse,
  MoveBookmarkResponse,
  GetBookmarkUsageResponse,
  IconOverrideScope,
  RecordBookmarkUseResponse,
  WorkspaceRecord,
  GetWorkspacesResponse,
  CreateWorkspaceResponse,
  PatchWorkspaceResponse,
  DeleteWorkspaceResponse,
  OpenTabResponse,
  SyncErrorResponse,
  SyncPushResponse,
  SyncPullResponse,
  SyncPullNotFoundResponse,
  GetSyncPairingCodeResponse,
  AdoptSyncSecretResponse,
  WebSearchResponse,
} from '@/shared/messages';
import { IconFetchError, SyncFetchError, messageTypes } from '@/shared/messages';

async function send<T extends AppResponse>(req: AppRequest): Promise<T> {
  const res = (await extensionApi.runtime.sendMessage(req)) as T | AppErrorResponse | SyncErrorResponse | undefined;
  if (res && typeof res === 'object' && '__syncError' in res) {
    const { kind, message, httpStatus } = (res as SyncErrorResponse).__syncError;
    throw new SyncFetchError(kind, message, httpStatus);
  }
  if (res && typeof res === 'object' && '__error' in res) {
    const { kind, message, httpStatus } = (res as AppErrorResponse).__error;
    throw new IconFetchError(kind, message, httpStatus);
  }
  if (res === undefined) {
    throw new IconFetchError('unknown', 'No response from background service worker.');
  }
  return res as T;
}

export async function getSettings(): Promise<AppSettings> {
  const res = await send<GetSettingsResponse>({ type: messageTypes.getSettings });
  return res.settings;
}

export async function patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const res = await send<PatchSettingsResponse>({ type: messageTypes.patchSettings, patch });
  return res.settings;
}

export async function getBookmarkTree(): Promise<BookmarkNode[]> {
  const res = await send<GetBookmarkTreeResponse>({ type: messageTypes.getBookmarkTree });
  return res.tree;
}

export async function getIcon(bookmarkUrl: string, bookmarkTitle?: string): Promise<ResolvedIcon> {
  const res = await send<GetIconResponse>({ type: messageTypes.getIcon, bookmarkUrl, bookmarkTitle });
  return res.icon;
}

export async function updateBookmark(bookmarkId: string, changes: { title?: string; url?: string }): Promise<BookmarkNode> {
  const res = await send<UpdateBookmarkResponse>({ type: messageTypes.updateBookmark, bookmarkId, changes });
  return res.bookmark;
}

export async function createBookmark(parentId: string, title: string, url?: string, index?: number): Promise<BookmarkNode> {
  const res = await send<CreateBookmarkResponse>({ type: messageTypes.createBookmark, parentId, title, url, index });
  return res.bookmark;
}

export async function removeBookmark(bookmarkId: string, recursive?: boolean): Promise<void> {
  await send<RemoveBookmarkResponse>({ type: messageTypes.removeBookmark, bookmarkId, recursive });
}

export async function moveBookmark(bookmarkId: string, parentId: string, index?: number): Promise<BookmarkNode> {
  const res = await send<MoveBookmarkResponse>({ type: messageTypes.moveBookmark, bookmarkId, parentId, index });
  return res.bookmark;
}

export async function searchIcons(query: string, bookmarkUrl?: string): Promise<IconSearchCandidate[]> {
  const res = await send<SearchIconsResponse>({ type: messageTypes.searchIcons, query, bookmarkUrl });
  return res.candidates;
}

export async function setIconOverride(args: {
  bookmarkUrl: string;
  bookmarkTitle?: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  scope?: IconOverrideScope;
}): Promise<ResolvedIcon> {
  const res = await send<SetIconOverrideResponse>({ type: messageTypes.setIconOverride, ...args });
  return res.icon;
}

export async function setIconOverrideFromUrl(args: {
  bookmarkUrl: string;
  bookmarkTitle?: string;
  imageUrl: string;
  fallbackImageUrl?: string;
  fileName?: string;
  scope?: IconOverrideScope;
}): Promise<ResolvedIcon> {
  const res = await send<SetIconOverrideFromUrlResponse>({ type: messageTypes.setIconOverrideFromUrl, ...args });
  return res.icon;
}

export async function removeIconOverride(bookmarkUrl: string, bookmarkTitle?: string): Promise<ResolvedIcon> {
  const res = await send<RemoveIconOverrideResponse>({ type: messageTypes.removeIconOverride, bookmarkUrl, bookmarkTitle });
  return res.icon;
}

export async function invalidateIcon(bookmarkUrl?: string): Promise<void> {
  await send<InvalidateIconResponse>({ type: messageTypes.invalidateIcon, bookmarkUrl });
}

export async function getBookmarkUsage(): Promise<Record<string, number>> {
  const res = await send<GetBookmarkUsageResponse>({ type: messageTypes.getBookmarkUsage });
  return res.usage;
}

export async function recordBookmarkUse(bookmarkId: string): Promise<number> {
  const res = await send<RecordBookmarkUseResponse>({ type: messageTypes.recordBookmarkUse, bookmarkId });
  return res.usedAt;
}

export async function getWorkspaces(): Promise<WorkspaceRecord[]> {
  const res = await send<GetWorkspacesResponse>({ type: messageTypes.getWorkspaces });
  return res.workspaces;
}

export async function createWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
  const res = await send<CreateWorkspaceResponse>({ type: messageTypes.createWorkspace, workspace });
  return res.workspace;
}

export async function patchWorkspace(id: string, patch: Partial<WorkspaceRecord>): Promise<WorkspaceRecord> {
  const res = await send<PatchWorkspaceResponse>({ type: messageTypes.patchWorkspace, id, patch });
  return res.workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
  await send<DeleteWorkspaceResponse>({ type: messageTypes.deleteWorkspace, id });
}

export async function openTab(url: string): Promise<void> {
  await send<OpenTabResponse>({ type: messageTypes.openTab, url });
}

// Settings sync (#7). `bundle` is the WorkspaceExportPayload from
// newtab/lib/workspace-transfer.ts's buildWorkspaceExport(); typed as unknown
// at the message boundary (see messages.ts comment) and narrowed by the caller.
export async function syncPush(bundle: unknown): Promise<void> {
  await send<SyncPushResponse>({ type: messageTypes.syncPush, bundle });
}

// Returns the decrypted export payload (untyped — caller narrows/validates,
// same shape parseWorkspaceFile expects) or null when the server has nothing
// stored yet for this device's pairing (404). Applying it via
// applyWorkspaceImport(payload, 'merge') is the UI wave's responsibility.
export async function syncPull(): Promise<unknown | null> {
  const res = await send<SyncPullResponse | SyncPullNotFoundResponse>({ type: messageTypes.syncPull });
  return res.found ? res.payload : null;
}

// Dry-run pull for the link-preview dialog (see sync-client.previewPull): the
// pasted code is used for auth/decrypt but NOT adopted. Returns the decrypted
// payload, or null when that namespace has nothing stored yet.
export async function syncPreviewPull(pairingCode: string): Promise<unknown | null> {
  const res = await send<SyncPullResponse | SyncPullNotFoundResponse>({
    type: messageTypes.syncPreviewPull,
    pairingCode,
  });
  return res.found ? res.payload : null;
}

export async function getSyncPairingCode(): Promise<string> {
  const res = await send<GetSyncPairingCodeResponse>({ type: messageTypes.getSyncPairingCode });
  return res.pairingCode;
}

export async function adoptSyncSecret(pairingCode: string): Promise<void> {
  await send<AdoptSyncSecretResponse>({ type: messageTypes.adoptSyncSecret, pairingCode });
}

export async function webSearch(query: string, openInNewTab: boolean): Promise<void> {
  await send<WebSearchResponse>({ type: messageTypes.webSearch, query, openInNewTab });
}
