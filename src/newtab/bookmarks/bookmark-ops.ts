import { sendRuntimeMessage } from '../../shared/browser';
import { messageTypes, type BookmarkNode, type CreateBookmarkResponse, type MoveBookmarkResponse, type RemoveBookmarkResponse } from '../../shared/messages';
import { getHostname } from './bookmark-navigation';

export async function cloneBookmarkSubtree(parentId: string, sourceNode: BookmarkNode, index?: number): Promise<BookmarkNode> {
  if (sourceNode.url) {
    const response = await sendRuntimeMessage<{
      type: typeof messageTypes.createBookmark;
      parentId: string;
      title: string;
      url?: string;
      index?: number;
    }, CreateBookmarkResponse>({
      type: messageTypes.createBookmark,
      parentId,
      title: sourceNode.title || getHostname(sourceNode.url),
      url: sourceNode.url,
      index,
    });
    return response.bookmark;
  }

  const response = await sendRuntimeMessage<{
    type: typeof messageTypes.createBookmark;
    parentId: string;
    title: string;
    url?: string;
    index?: number;
  }, CreateBookmarkResponse>({
    type: messageTypes.createBookmark,
    parentId,
    title: sourceNode.title || 'Untitled',
    index,
  });

  for (const child of sourceNode.children ?? []) {
    await cloneBookmarkSubtree(response.bookmark.id, child);
  }

  return response.bookmark;
}

export async function removeBookmarkSubtree(bookmarkId: string, recursive = false): Promise<void> {
  await sendRuntimeMessage<{
    type: typeof messageTypes.removeBookmark;
    bookmarkId: string;
    recursive?: boolean;
  }, RemoveBookmarkResponse>({
    type: messageTypes.removeBookmark,
    bookmarkId,
    recursive,
  });
}

export async function applyFolderOrder(parentId: string, orderedIds: string[]): Promise<void> {
  for (const [index, bookmarkId] of orderedIds.entries()) {
    await sendRuntimeMessage<{
      type: typeof messageTypes.moveBookmark;
      bookmarkId: string;
      parentId: string;
      index?: number;
    }, MoveBookmarkResponse>({
      type: messageTypes.moveBookmark,
      bookmarkId,
      parentId,
      index,
    });
  }
}