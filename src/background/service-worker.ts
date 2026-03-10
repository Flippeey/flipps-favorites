import { extensionApi } from '../shared/browser';
import { messageTypes, type AppRequest, type AppResponse, type BookmarkNode } from '../shared/messages';
import { readSettings, writeSettings } from '../shared/storage';

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
    default:
      throw new Error(`Unhandled message type: ${(message as AppRequest).type}`);
  }
}

async function getBookmarkTree(): Promise<BookmarkNode[]> {
  const nodes = await extensionApi.bookmarks.getTree();
  return normalizeBookmarkNodes(nodes);
}

function normalizeBookmarkNodes(nodes: any[]): BookmarkNode[] {
  return nodes.map(node => ({
    id: String(node.id),
    parentId: node.parentId ? String(node.parentId) : undefined,
    title: node.title || 'Untitled',
    url: node.url,
    children: node.children ? normalizeBookmarkNodes(node.children) : undefined,
  }));
}
