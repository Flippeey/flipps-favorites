import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type BookmarkNode, type MoveBookmarkResponse, type ResolvedIcon } from '../shared/messages';
import { pushUndoEntry, type AppState, type BookmarkItemKind, type FolderActionTarget, type SelectionScope, type SelectionSurface } from './app-state';
import { getBookmarkActionTarget, getFolderChildIds, getFolderNode, getHostname, isFolderDescendantOf } from './bookmark-navigation';
import { markBookmarkUsed } from './bookmark-usage';
import { escapeHtml } from './html';
import { renderBookmarkVisualIcon } from './icon-render';
import { measureAsync } from './performance';
import { openBookmark, openFolderView } from './runtime-helpers';
import { clearSelection, createSelectionContextMenuState, getFolderChildren, getOrderedSelectedIds, getSelectedNodes, getVisibleChildren, isSameScope, setSelection } from './selection-state';
import { navigateToFolderAndRender, refreshTreeAndRender, type RenderAppFn } from './state-transitions';

export function setupGridInteractions(rootElement: HTMLDivElement, state: AppState, bookmarkCanvas: HTMLElement | null, bookmarkGrid: HTMLElement | null, currentFolder: BookmarkNode, renderApp: RenderAppFn): void {
  setupSurfaceInteractions(rootElement, state, renderApp, {
    surface: 'grid',
    surfaceElement: bookmarkCanvas,
    itemContainer: bookmarkGrid,
    folderId: currentFolder.id,
    itemSelector: '[data-grid-item-id]',
    idDatasetKey: 'gridItemId',
    kindDatasetKey: 'gridItemKind',
    marqueeSelector: '.selection-marquee',
  });
}

export function setupDockInteractions(rootElement: HTMLDivElement, state: AppState, bookmarkDock: HTMLElement | null, dockStrip: HTMLElement | null, dockFolder: BookmarkNode | null, renderApp: RenderAppFn): void {
  if (!dockFolder) {
    return;
  }

  setupSurfaceInteractions(rootElement, state, renderApp, {
    surface: 'dock',
    surfaceElement: bookmarkDock,
    itemContainer: dockStrip,
    folderId: dockFolder.id,
    itemSelector: '[data-dock-item-id]',
    idDatasetKey: 'dockItemId',
    kindDatasetKey: 'dockItemKind',
    marqueeSelector: '.selection-marquee--dock',
  });
}

export function getFolderActionTarget(element: HTMLElement): FolderActionTarget | null {
  const id = element.dataset.folderId;
  if (!id) {
    return null;
  }

  return {
    id,
    title: element.dataset.folderTitle || 'Untitled',
    parentId: element.dataset.parentId || '',
  };
}

function setupSurfaceInteractions(
  rootElement: HTMLDivElement,
  state: AppState,
  renderApp: RenderAppFn,
  config: {
    surface: SelectionSurface;
    surfaceElement: HTMLElement | null;
    itemContainer: HTMLElement | null;
    folderId: string;
    itemSelector: string;
    idDatasetKey: 'gridItemId' | 'dockItemId';
    kindDatasetKey: 'gridItemKind' | 'dockItemKind';
    marqueeSelector: string;
  },
): void {
  const { surface, surfaceElement, itemContainer, folderId, itemSelector, idDatasetKey, kindDatasetKey, marqueeSelector } = config;
  if (!surfaceElement || !itemContainer) {
    return;
  }

  const scope: SelectionScope = { surface, folderId };
  const shellElement = rootElement.querySelector<HTMLElement>('.shell');
  const dragPreviewElement = ensureDragPreviewElement(shellElement);
  const marqueeElement = surfaceElement.querySelector<HTMLElement>(marqueeSelector);
  const itemButtons = Array.from(itemContainer.querySelectorAll<HTMLButtonElement>(itemSelector));
  const folderButtons = Array.from(itemContainer.querySelectorAll<HTMLButtonElement>(`.folder-card${itemSelector}`));
  const linkButtons = Array.from(itemContainer.querySelectorAll<HTMLButtonElement>(`[data-link-url]${itemSelector}`));
  const threshold = 6;

  let interaction:
    | {
        kind: 'pending-marquee' | 'marquee';
        pointerId: number;
        startX: number;
        startY: number;
      }
    | {
        kind: 'pending-drag' | 'dragging';
        pointerId: number;
        startX: number;
        startY: number;
        sourceButton: HTMLButtonElement;
        dragIds: string[];
        dropTarget: { kind: 'reorder'; index: number } | { kind: 'folder'; folderId: string } | null;
      }
    | null = null;

  const visibleItems = getVisibleChildren(state, scope);
  const buttonById = new Map(itemButtons.map(button => [button.dataset[idDatasetKey] || '', button]));
  const dragDisabled = surface === 'grid' && folderId === state.currentFolderId && (state.settings.bookmarkSortMode !== 'manual' || Boolean(state.searchQuery.trim()));

  const setButtonSelectionState = (selectedIds: string[]) => {
    const selectedSet = new Set(selectedIds);
    itemButtons.forEach(button => {
      button.dataset.selected = String(selectedSet.has(button.dataset[idDatasetKey] || ''));
    });
  };

  const clearDropIndicator = () => {
    itemButtons.forEach(button => {
      delete button.dataset.dropPosition;
      delete button.dataset.dragSource;
      delete button.dataset.dragLead;
      delete button.dataset.dragCount;
    });

    if (shellElement) {
      delete shellElement.dataset.dragActive;
      delete shellElement.dataset.dragSurface;
      delete shellElement.dataset.dragCount;
    }
  };

  const hideDragPreview = () => {
    if (!dragPreviewElement) {
      return;
    }

    dragPreviewElement.hidden = true;
    dragPreviewElement.removeAttribute('data-visible');
    dragPreviewElement.style.removeProperty('left');
    dragPreviewElement.style.removeProperty('top');
  };

  const updateDragPreview = (clientX: number, clientY: number, dragIds: string[]) => {
    if (!dragPreviewElement) {
      return;
    }

    const dragNodes = visibleItems.filter(node => dragIds.includes(node.id));
    const visualElement = dragPreviewElement.querySelector<HTMLElement>('[data-drag-preview-visual]');
    const countElement = dragPreviewElement.querySelector<HTMLElement>('[data-drag-preview-count]');

    if (visualElement) {
      visualElement.innerHTML = renderDragPreviewVisuals(dragNodes, state.resolvedIcons);
    }
    if (countElement) {
      countElement.textContent = String(dragNodes.length);
      countElement.hidden = dragNodes.length <= 1;
    }

    dragPreviewElement.hidden = false;
    dragPreviewElement.dataset.visible = 'true';
    dragPreviewElement.style.left = `${clientX + 18}px`;
    dragPreviewElement.style.top = `${clientY + 18}px`;
  };

  const hideMarquee = () => {
    if (marqueeElement) {
      marqueeElement.hidden = true;
      marqueeElement.removeAttribute('style');
    }
  };

  const suppressNextClick = (button: HTMLButtonElement) => {
    button.dataset.suppressClick = 'true';
  };

  const updateMarquee = (clientX: number, clientY: number) => {
    if (!marqueeElement || !interaction || (interaction.kind !== 'pending-marquee' && interaction.kind !== 'marquee')) {
      return;
    }

    const activeInteraction = interaction;
    const marqueeBoundsElement = marqueeElement.parentElement instanceof HTMLElement
      ? marqueeElement.parentElement
      : surfaceElement;
    const surfaceRect = marqueeBoundsElement.getBoundingClientRect();
    const left = Math.min(activeInteraction.startX, clientX) - surfaceRect.left;
    const top = Math.min(activeInteraction.startY, clientY) - surfaceRect.top;
    const width = Math.abs(clientX - activeInteraction.startX);
    const height = Math.abs(clientY - activeInteraction.startY);

    marqueeElement.hidden = false;
    marqueeElement.style.left = `${left}px`;
    marqueeElement.style.top = `${top}px`;
    marqueeElement.style.width = `${width}px`;
    marqueeElement.style.height = `${height}px`;

    const selectedIds = itemButtons
      .filter(button => rectsIntersect(button.getBoundingClientRect(), {
        left: Math.min(activeInteraction.startX, clientX),
        right: Math.max(activeInteraction.startX, clientX),
        top: Math.min(activeInteraction.startY, clientY),
        bottom: Math.max(activeInteraction.startY, clientY),
      }))
      .map(button => button.dataset[idDatasetKey] || '')
      .filter(Boolean);

    setSelection(state, selectedIds, scope);
    setButtonSelectionState(selectedIds);
  };

  const updateDragState = (clientX: number, clientY: number) => {
    if (!interaction || interaction.kind !== 'dragging') {
      return;
    }

    const dragIdSet = new Set(interaction.dragIds);
    clearDropIndicator();
    if (shellElement) {
      shellElement.dataset.dragActive = 'true';
      shellElement.dataset.dragSurface = surface;
      shellElement.dataset.dragCount = String(interaction.dragIds.length);
    }
    interaction.dragIds.forEach(id => {
      buttonById.get(id)?.setAttribute('data-drag-source', 'true');
    });
    const leadButton = buttonById.get(interaction.dragIds[0] || '');
    leadButton?.setAttribute('data-drag-lead', 'true');
    if (leadButton) {
      leadButton.dataset.dragCount = String(interaction.dragIds.length);
    }
    updateDragPreview(clientX, clientY, interaction.dragIds);

    const hoveredButton = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLButtonElement>(itemSelector);
    if (!hoveredButton) {
      interaction.dropTarget = { kind: 'reorder', index: visibleItems.filter(item => !dragIdSet.has(item.id)).length };
      return;
    }

    const hoveredId = hoveredButton.dataset[idDatasetKey] || '';
    const hoveredKind = hoveredButton.dataset[kindDatasetKey] as BookmarkItemKind | undefined;
    if (!dragIdSet.has(hoveredId) && hoveredKind === 'folder' && canMoveItemsIntoFolder(state, interaction.dragIds, hoveredId, scope)) {
      hoveredButton.dataset.dropPosition = 'inside';
      interaction.dropTarget = { kind: 'folder', folderId: hoveredId };
      return;
    }

    if (dragIdSet.has(hoveredId)) {
      interaction.dropTarget = null;
      return;
    }

    const rect = hoveredButton.getBoundingClientRect();
    const placeAfter = surface === 'dock'
      ? clientX > rect.left + rect.width / 2
      : (clientY > rect.top + rect.height * 0.7 || (clientY >= rect.top + rect.height * 0.3 && clientX > rect.left + rect.width / 2));
    hoveredButton.dataset.dropPosition = placeAfter ? 'after' : 'before';

    const remainingItems = visibleItems.filter(item => !dragIdSet.has(item.id));
    const remainingIndex = remainingItems.findIndex(item => item.id === hoveredId);
    interaction.dropTarget = {
      kind: 'reorder',
      index: remainingIndex === -1 ? remainingItems.length : remainingIndex + (placeAfter ? 1 : 0),
    };
  };

  const finishInteraction = async () => {
    hideMarquee();
    hideDragPreview();
    if (!interaction) {
      return;
    }

    const completedInteraction = interaction;
    interaction = null;

    if (completedInteraction.kind === 'dragging') {
      clearDropIndicator();
      if (completedInteraction.dropTarget?.kind === 'folder') {
        const moved = await moveSelectionIntoFolder(rootElement, state, renderApp, completedInteraction.dragIds, completedInteraction.dropTarget.folderId, scope);
        if (!moved) {
          renderApp(rootElement, state);
        }
        return;
      }

      if (completedInteraction.dropTarget?.kind === 'reorder') {
        const reordered = await reorderSelection(rootElement, state, renderApp, completedInteraction.dragIds, completedInteraction.dropTarget.index, scope);
        if (!reordered) {
          renderApp(rootElement, state);
        }
        return;
      }
    }

    if (completedInteraction.kind === 'marquee') {
      renderApp(rootElement, state);
      return;
    }

    clearDropIndicator();
  };

  itemButtons.forEach(button => {
    button.addEventListener('dragstart', event => {
      event.preventDefault();
    });

    button.addEventListener('click', event => {
      if (button.dataset.suppressClick === 'true') {
        button.dataset.suppressClick = 'false';
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const itemId = button.dataset[idDatasetKey];
      if (!itemId) {
        return;
      }

      const item = visibleItems.find(node => node.id === itemId);
      if (!item) {
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        markBookmarkUsed(state, item.id);
        if (item.url) {
          openBookmark(item.url, true);
          return;
        }

        openFolderView(item.id, true);
        return;
      }

      if (item.url) {
        markBookmarkUsed(state, item.id);
        openBookmark(item.url, state.settings.openLinksInNewTab);
        return;
      }

      markBookmarkUsed(state, item.id);
      navigateToFolderAndRender(rootElement, state, item.id, renderApp);
    });
  });

  surfaceElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) {
      return;
    }

    if (state.contextMenu) {
      state.contextMenu = null;
      renderApp(rootElement, state);
      return;
    }

    const target = event.target as HTMLElement | null;
    const itemButton = target?.closest<HTMLButtonElement>(itemSelector);
    if (!itemButton) {
      state.contextMenu = null;
      clearSelection(state);
      interaction = {
        kind: 'pending-marquee',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
      event.preventDefault();
      surfaceElement.setPointerCapture(event.pointerId);
      setButtonSelectionState([]);
      return;
    }

    const itemId = itemButton.dataset[idDatasetKey];
    if (!itemId) {
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      const nextSelectedIds = new Set(isSameScope(state.selectionScope, scope) ? state.selectedIds : []);
      if (nextSelectedIds.has(itemId)) {
        nextSelectedIds.delete(itemId);
      } else {
        nextSelectedIds.add(itemId);
      }

      const orderedIds = visibleItems.filter(node => nextSelectedIds.has(node.id)).map(node => node.id);
      setSelection(state, orderedIds, scope, itemId);
      state.contextMenu = null;
      suppressNextClick(itemButton);
      renderApp(rootElement, state);
      return;
    }

    if (dragDisabled) {
      return;
    }

    interaction = {
      kind: 'pending-drag',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      sourceButton: itemButton,
      dragIds: isSameScope(state.selectionScope, scope) && state.selectedIds.includes(itemId) && state.selectedIds.length
        ? getOrderedSelectedIds(state, scope)
        : [itemId],
      dropTarget: null,
    };
  });

  surfaceElement.addEventListener('pointermove', event => {
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - interaction.startX, event.clientY - interaction.startY);
    if (interaction.kind === 'pending-marquee' && distance >= threshold) {
      interaction.kind = 'marquee';
    }

    if (interaction.kind === 'marquee') {
      updateMarquee(event.clientX, event.clientY);
      return;
    }

    if (interaction.kind === 'pending-drag' && distance >= threshold) {
      if (!surfaceElement.hasPointerCapture(event.pointerId)) {
        surfaceElement.setPointerCapture(event.pointerId);
      }

      interaction.kind = 'dragging';
      setSelection(state, interaction.dragIds, scope, interaction.dragIds[0] ?? null);
      setButtonSelectionState(interaction.dragIds);
      suppressNextClick(interaction.sourceButton);
    }

    if (interaction.kind === 'dragging') {
      event.preventDefault();
      updateDragState(event.clientX, event.clientY);
    }
  });

  const endPointerInteraction = (event: PointerEvent) => {
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    void finishInteraction();
  };

  surfaceElement.addEventListener('pointerup', endPointerInteraction);
  surfaceElement.addEventListener('pointercancel', endPointerInteraction);

  folderButtons.forEach(button => {
    button.addEventListener('contextmenu', event => {
      const target = getFolderActionTarget(button);
      const itemId = button.dataset[idDatasetKey];
      if (!target || !itemId) {
        return;
      }

      event.preventDefault();
      if (!isSameScope(state.selectionScope, scope) || !state.selectedIds.includes(itemId)) {
        setSelection(state, [itemId], scope, itemId);
      }

      state.contextMenu = state.selectedIds.length > 1
        ? createSelectionContextMenuState(state, event.clientX, event.clientY, scope)
        : {
            kind: 'folder',
            x: event.clientX,
            y: event.clientY,
            target,
          };
      renderApp(rootElement, state);
    });
  });

  linkButtons.forEach(button => {
    button.addEventListener('contextmenu', event => {
      const target = getBookmarkActionTarget(button);
      const itemId = button.dataset[idDatasetKey];
      if (!target || !itemId) {
        return;
      }

      event.preventDefault();
      if (!isSameScope(state.selectionScope, scope) || !state.selectedIds.includes(itemId)) {
        setSelection(state, [itemId], scope, itemId);
      }

      state.contextMenu = state.selectedIds.length > 1
        ? createSelectionContextMenuState(state, event.clientX, event.clientY, scope)
        : {
            kind: 'bookmark',
            x: event.clientX,
            y: event.clientY,
            target,
          };
      renderApp(rootElement, state);
    });
  });
}

function ensureDragPreviewElement(shellElement: HTMLElement | null): HTMLElement | null {
  if (!shellElement) {
    return null;
  }

  const existing = shellElement.querySelector<HTMLElement>('.drag-cursor-preview');
  if (existing) {
    return existing;
  }

  const element = document.createElement('div');
  element.className = 'drag-cursor-preview';
  element.hidden = true;
  element.setAttribute('aria-hidden', 'true');
  element.innerHTML = `
    <div class="drag-cursor-preview__visual" data-drag-preview-visual></div>
    <span class="drag-cursor-preview__count" data-drag-preview-count hidden>1</span>
  `;
  shellElement.appendChild(element);
  return element;
}

function renderDragPreviewVisuals(nodes: BookmarkNode[], resolvedIcons: Record<string, ResolvedIcon>): string {
  return nodes.slice(0, 3).map((node, index) => renderDragPreviewVisual(node, resolvedIcons, index)).join('');
}

function renderDragPreviewVisual(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, index: number): string {
  const offsetStyle = `style="--drag-preview-offset:${String(index)};"`;
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'dock');
    return `<span class="drag-cursor-preview__thumb drag-cursor-preview__thumb--bookmark" ${offsetStyle}>${visualMarkup}</span>`;
  }

  return `
    <span class="drag-cursor-preview__thumb drag-cursor-preview__thumb--folder" ${offsetStyle}>
      <span class="drag-cursor-preview__folder-grid">
        ${renderDragPreviewFolderCells(node, resolvedIcons)}
      </span>
    </span>
  `;
}

function renderDragPreviewFolderCells(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>): string {
  const previewItems = getDragPreviewFolderItems(node).slice(0, 4);
  if (!previewItems.length) {
    return `<span class="drag-cursor-preview__folder-cell drag-cursor-preview__folder-cell--empty">${escapeHtml(getInitial(node.title || 'Folder'))}</span>`;
  }

  return previewItems.map(child => {
    if (child.url) {
      const label = child.title || getHostname(child.url);
      const resolvedIcon = resolvedIcons[child.url];
      return `<span class="drag-cursor-preview__folder-cell drag-cursor-preview__folder-cell--bookmark">${renderBookmarkVisualIcon(child.url, label, resolvedIcon, 'dock')}</span>`;
    }

    const childCount = child.children?.length ?? 0;
    return `<span class="drag-cursor-preview__folder-cell drag-cursor-preview__folder-cell--folder">${escapeHtml(childCount > 0 ? String(childCount) : getInitial(child.title || 'Folder'))}</span>`;
  }).join('');
}

function rectsIntersect(a: DOMRect, b: { left: number; right: number; top: number; bottom: number }): boolean {
  return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
}

function canMoveItemsIntoFolder(state: AppState, dragIds: string[], targetFolderId: string, scope: SelectionScope): boolean {
  const dragNodes = getSelectedNodes(state, dragIds, scope);
  if (!dragNodes.length || !getFolderNode(state.tree, targetFolderId)) {
    return false;
  }

  for (const node of dragNodes) {
    if (node.id === targetFolderId) {
      return false;
    }

    if (!node.url && isFolderDescendantOf(state.tree, targetFolderId, node.id)) {
      return false;
    }
  }

  return true;
}

async function reorderSelection(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn, dragIds: string[], dropIndex: number, scope: SelectionScope): Promise<boolean> {
  return measureAsync('surface-reorder-selection', {
    surface: scope.surface,
    folderId: scope.folderId,
    dragCount: dragIds.length,
    dropIndex,
  }, async () => {
    const beforeOrder = getFolderChildIds(state.tree, scope.folderId);
    const currentChildren = getFolderChildren(state, scope.folderId);
    const dragIdSet = new Set(dragIds);
    const draggedItems = currentChildren.filter(node => dragIdSet.has(node.id));
    if (!draggedItems.length) {
      return false;
    }

    const remainingItems = currentChildren.filter(node => !dragIdSet.has(node.id));
    const normalizedDropIndex = clamp(dropIndex, 0, remainingItems.length);
    const nextOrder = [
      ...remainingItems.slice(0, normalizedDropIndex),
      ...draggedItems,
      ...remainingItems.slice(normalizedDropIndex),
    ];

    if (nextOrder.every((item, index) => item.id === currentChildren[index]?.id)) {
      return false;
    }

    for (const [index, item] of nextOrder.entries()) {
      await sendRuntimeMessage<{
        type: typeof messageTypes.moveBookmark;
        bookmarkId: string;
        parentId: string;
        index?: number;
      }, MoveBookmarkResponse>({
        type: messageTypes.moveBookmark,
        bookmarkId: item.id,
        parentId: scope.folderId,
        index,
      });
    }

    setSelection(state, draggedItems.map(item => item.id), scope);
    await refreshTreeAndRender(rootElement, state, renderApp, { warmIcons: true });
    pushUndoEntry(state, {
      kind: 'move',
      label: draggedItems.length === 1 ? 'Reordered 1 item' : `Reordered ${String(draggedItems.length)} items`,
      snapshots: [{
        folderId: scope.folderId,
        before: beforeOrder,
        after: getFolderChildIds(state.tree, scope.folderId),
      }],
    });
    return true;
  });
}

async function moveSelectionIntoFolder(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn, dragIds: string[], targetFolderId: string, scope: SelectionScope): Promise<boolean> {
  return measureAsync('surface-move-selection-into-folder', {
    surface: scope.surface,
    sourceFolderId: scope.folderId,
    targetFolderId,
    dragCount: dragIds.length,
  }, async () => {
    if (!canMoveItemsIntoFolder(state, dragIds, targetFolderId, scope)) {
      return false;
    }

    const beforeSourceOrder = getFolderChildIds(state.tree, scope.folderId);
    const beforeTargetOrder = getFolderChildIds(state.tree, targetFolderId);
    const dragNodes = getSelectedNodes(state, dragIds, scope);
    const targetChildren = getFolderChildren(state, targetFolderId);
    let nextIndex = targetChildren.length;
    for (const node of dragNodes) {
      await sendRuntimeMessage<{
        type: typeof messageTypes.moveBookmark;
        bookmarkId: string;
        parentId: string;
        index?: number;
      }, MoveBookmarkResponse>({
        type: messageTypes.moveBookmark,
        bookmarkId: node.id,
        parentId: targetFolderId,
        index: nextIndex,
      });
      nextIndex += 1;
    }

    clearSelection(state);
    await refreshTreeAndRender(rootElement, state, renderApp, { warmIcons: true });
    pushUndoEntry(state, {
      kind: 'move',
      label: dragNodes.length === 1 ? 'Moved 1 item' : `Moved ${String(dragNodes.length)} items`,
      snapshots: [
        {
          folderId: scope.folderId,
          before: beforeSourceOrder,
          after: getFolderChildIds(state.tree, scope.folderId),
        },
        {
          folderId: targetFolderId,
          before: beforeTargetOrder,
          after: getFolderChildIds(state.tree, targetFolderId),
        },
      ],
    });
    return true;
  });
}

function getDragPreviewFolderItems(node: BookmarkNode): BookmarkNode[] {
  return (node.children ?? []).slice(0, 4);
}

function getInitial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || '?';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}