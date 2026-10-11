import { extensionApi } from '@/shared/browser';
import type {
  AppErrorResponse,
  AppRequest,
  AppResponse,
  AppSettings,
  BookmarkNode,
  FolderIconOverrideRecord,
  GetBookmarkTreeResponse,
  GetFolderIconResponse,
  GetIconResponse,
  GetSettingsResponse,
  IconSearchCandidate,
  InvalidateIconResponse,
  PatchSettingsResponse,
  RemoveFolderIconResponse,
  RemoveIconOverrideResponse,
  ResolvedIcon,
  SearchIconsResponse,
  SetFolderIconFromUrlResponse,
  SetFolderIconResponse,
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
  PingResponse,
  WebSearchResponse,
} from '@/shared/messages';
import { IconFetchError, messageTypes } from '@/shared/messages';

async function send<T extends AppResponse>(req: AppRequest): Promise<T> {
  const res = (await extensionApi.runtime.sendMessage(req)) as T | AppErrorResponse | undefined;
  if (res && typeof res === 'object' && '__error' in res) {
    const { kind, message, httpStatus } = (res as AppErrorResponse).__error;
    throw new IconFetchError(kind, message, httpStatus);
  }
  if (res === undefined) {
    throw new IconFetchError('unknown', 'No response from background service worker.');
  }
  return res as T;
}

// Firefox suspends its background event page once it has seen no event for
// the idle timeout, even while a reply is pending. Requests that wait on the
// network (icon resolution, image search and download) can outlast it, so
// while any is pending one shared timer pings the background; each delivered
// message resets the idle timer. On Chrome the pings extend the service
// worker's lifetime the same way.
const KEEP_ALIVE_INTERVAL_MS = 1_000;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveHolders = 0;

async function sendKeepingBackgroundAlive<T extends AppResponse>(req: AppRequest): Promise<T> {
  keepAliveHolders += 1;
  keepAliveTimer ??= setInterval(() => {
    void send<PingResponse>({ type: messageTypes.ping }).catch(() => undefined);
  }, KEEP_ALIVE_INTERVAL_MS);
  try {
    return await send<T>(req);
  } finally {
    keepAliveHolders -= 1;
    if (keepAliveHolders === 0 && keepAliveTimer !== null) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }
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
  const res = await sendKeepingBackgroundAlive<GetIconResponse>({ type: messageTypes.getIcon, bookmarkUrl, bookmarkTitle });
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
  const res = await sendKeepingBackgroundAlive<SearchIconsResponse>({ type: messageTypes.searchIcons, query, bookmarkUrl });
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
  const res = await sendKeepingBackgroundAlive<SetIconOverrideFromUrlResponse>({ type: messageTypes.setIconOverrideFromUrl, ...args });
  return res.icon;
}

export async function removeIconOverride(bookmarkUrl: string, bookmarkTitle?: string): Promise<ResolvedIcon> {
  const res = await sendKeepingBackgroundAlive<RemoveIconOverrideResponse>({ type: messageTypes.removeIconOverride, bookmarkUrl, bookmarkTitle });
  return res.icon;
}

export async function invalidateIcon(bookmarkUrl?: string): Promise<void> {
  await send<InvalidateIconResponse>({ type: messageTypes.invalidateIcon, bookmarkUrl });
}

export async function getFolderIcon(folderId: string): Promise<FolderIconOverrideRecord | null> {
  const res = await send<GetFolderIconResponse>({ type: messageTypes.getFolderIcon, folderId });
  return res.icon;
}

export async function setFolderIcon(args: {
  folderId: string;
  dataUrl: string;
  fileName?: string;
  mimeType: string;
}): Promise<FolderIconOverrideRecord> {
  const res = await send<SetFolderIconResponse>({ type: messageTypes.setFolderIcon, ...args });
  return res.icon;
}

export async function setFolderIconFromUrl(args: {
  folderId: string;
  imageUrl: string;
  fallbackImageUrl?: string;
  fileName?: string;
}): Promise<FolderIconOverrideRecord> {
  const res = await sendKeepingBackgroundAlive<SetFolderIconFromUrlResponse>({ type: messageTypes.setFolderIconFromUrl, ...args });
  return res.icon;
}

export async function removeFolderIcon(folderId: string): Promise<void> {
  await send<RemoveFolderIconResponse>({ type: messageTypes.removeFolderIcon, folderId });
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

export async function webSearch(query: string, openInNewTab: boolean): Promise<void> {
  await send<WebSearchResponse>({ type: messageTypes.webSearch, query, openInNewTab });
}
