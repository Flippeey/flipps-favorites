import { extensionApi } from '../shared/browser';
import { messageTypes, type AppRequest, type AppResponse, type BookmarkNode } from '../shared/messages';
import { readSettings, writeSettings } from '../shared/storage';
import { getIcon, invalidateIcon, removeIconOverride, searchIcons, setIconOverride, setIconOverrideFromUrl } from './icon-service';

extensionApi.runtime.onInstalled.addListener(() => {
  console.info('Flipp\'s Favorites - Bookmarks & more installed');
});

extensionApi.runtime.onMessage.addListener((message: AppRequest) => {
  return handleMessage(message);
});

async function handleMessage(message: AppRequest): Promise<AppResponse> {
  switch (message.type) {
    case messageTypes.ping:
      return { ok: true, context: 'background' };
    case messageTypes.getSettings:
      return { settings: await readSettings() };
    case messageTypes.patchSettings:
      return { settings: await writeSettings(message.patch) };
    case messageTypes.getBookmarkTree:
      return { tree: await getBookmarkTree() };
    case messageTypes.updateBookmark:
      return { bookmark: normalizeBookmarkNode(await extensionApi.bookmarks.update(message.bookmarkId, message.changes)) };
    case messageTypes.removeBookmark:
      await extensionApi.bookmarks.remove(message.bookmarkId);
      return { ok: true };
    case messageTypes.getIcon:
      return { icon: await getIcon(message) };
    case messageTypes.searchIcons:
      return { candidates: await searchIcons(message.query, message.bookmarkUrl) };
    case messageTypes.setIconOverride:
      return { icon: await setIconOverride(message) };
    case messageTypes.setIconOverrideFromUrl:
      return { icon: await setIconOverrideFromUrl(message.bookmarkUrl, message.imageUrl, message.fileName) };
    case messageTypes.removeIconOverride:
      return { icon: await removeIconOverride(message.bookmarkUrl, message.bookmarkTitle) };
    case messageTypes.invalidateIcon:
      await invalidateIcon(message.bookmarkUrl);
      return { ok: true };
    default:
      throw new Error(`Unhandled message type: ${(message as AppRequest).type}`);
  }
}

async function getBookmarkTree(): Promise<BookmarkNode[]> {
  const nodes = await extensionApi.bookmarks.getTree();
  return normalizeBookmarkNodes(nodes);
}

function normalizeBookmarkNode(node: any): BookmarkNode {
  return {
    id: String(node.id),
    parentId: node.parentId ? String(node.parentId) : undefined,
    title: node.title || 'Untitled',
    url: node.url,
    children: node.children ? normalizeBookmarkNodes(node.children) : undefined,
  };
}

function normalizeBookmarkNodes(nodes: any[]): BookmarkNode[] {
  return nodes.map(normalizeBookmarkNode);
}
