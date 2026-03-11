import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type GetIconResponse } from '../shared/messages';
import type { AppState } from './app-state';
import { applyPendingIcon, applyResolvedIcon } from './icon-render';

let iconRenderGeneration = 0;

export function queueVisibleIconPreload(state: AppState): void {
  void preloadVisibleIcons(state);
}

export function hydrateBookmarkIcons(rootElement: HTMLDivElement, state: AppState): void {
  const currentGeneration = ++iconRenderGeneration;
  void hydrateVisibleBookmarkIcons(rootElement, state, currentGeneration);
}

async function preloadVisibleIcons(state: AppState): Promise<void> {
  const visibleBookmarks = state.derivedTree.visibleIconTargets;
  const pendingBookmarks = visibleBookmarks.filter(bookmark => !state.resolvedIcons[bookmark.url]);
  if (!pendingBookmarks.length) {
    return;
  }

  await Promise.allSettled(pendingBookmarks.map(async bookmark => {
    const response = await sendRuntimeMessage<{
      type: typeof messageTypes.getIcon;
      bookmarkUrl: string;
      bookmarkTitle?: string;
    }, GetIconResponse>({
      type: messageTypes.getIcon,
      bookmarkUrl: bookmark.url,
      bookmarkTitle: bookmark.title,
    });

    state.resolvedIcons[bookmark.url] = response.icon;
  }));
}

async function hydrateVisibleBookmarkIcons(rootElement: HTMLDivElement, state: AppState, generation: number): Promise<void> {
  const iconElements = Array.from(rootElement.querySelectorAll<HTMLElement>('[data-bookmark-icon]'));
  await Promise.allSettled(iconElements.map(async element => {
    const bookmarkUrl = element.dataset.iconUrl;
    if (!bookmarkUrl) {
      return;
    }

    const existingIcon = state.resolvedIcons[bookmarkUrl];
    if (existingIcon) {
      applyResolvedIcon(element, existingIcon);
      return;
    }

    const bookmarkTitle = element.dataset.iconTitle;
    try {
      const response = await sendRuntimeMessage<{
        type: typeof messageTypes.getIcon;
        bookmarkUrl: string;
        bookmarkTitle?: string;
      }, GetIconResponse>({
        type: messageTypes.getIcon,
        bookmarkUrl,
        bookmarkTitle,
      });

      if (generation !== iconRenderGeneration || !element.isConnected) {
        return;
      }

      state.resolvedIcons[bookmarkUrl] = response.icon;
      applyResolvedIcon(element, response.icon);
    } catch {
      if (generation !== iconRenderGeneration || !element.isConnected) {
        return;
      }

      applyPendingIcon(element);
    }
  }));
}