import { extensionApi } from '../../shared/browser';
import type {
  AppRequest,
  AppResponse,
  AppSettings,
  BookmarkNode,
  GetBookmarkTreeResponse,
  GetIconResponse,
  GetSettingsResponse,
  PatchSettingsResponse,
  ResolvedIcon,
  UpdateBookmarkResponse,
  CreateBookmarkResponse,
  RemoveBookmarkResponse,
  MoveBookmarkResponse,
} from '../../shared/messages';
import { messageTypes } from '../../shared/messages';

async function send<T extends AppResponse>(req: AppRequest): Promise<T> {
  return (await extensionApi.runtime.sendMessage(req)) as T;
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
