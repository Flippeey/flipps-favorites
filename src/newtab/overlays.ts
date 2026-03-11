import type { AppState, AppStatus, ContextMenuState } from './app-state';
import { escapeHtml } from './html';
import { renderUiIcon } from './ui-icons';

export function renderStatusMessage(statusMessage: AppStatus): string {
  return `
    <div class="app-status" data-kind="${statusMessage.kind}" role="status" aria-live="polite">
      <span>${escapeHtml(statusMessage.message)}</span>
      <button class="app-status__dismiss icon-button" type="button" aria-label="Dismiss message">${renderUiIcon('close')}</button>
    </div>
  `;
}

export function renderContextMenu(state: AppState, contextMenu: ContextMenuState, canPasteIntoFolder: (targetFolderId: string) => boolean): string {
  const x = clamp(contextMenu.x, 12, Math.max(12, window.innerWidth - 287));
  const estimatedHeight = contextMenu.kind === 'surface' ? 304 : contextMenu.kind === 'selection' ? 284 : 356;
  const shouldOpenUpward = contextMenu.y + estimatedHeight > window.innerHeight - 12;
  const anchoredY = shouldOpenUpward
    ? clamp(contextMenu.y, estimatedHeight + 12, window.innerHeight - 12)
    : clamp(contextMenu.y, 12, Math.max(12, window.innerHeight - estimatedHeight));
  const menuStyle = shouldOpenUpward
    ? `left:${x}px; top:${anchoredY}px; transform: translateY(calc(-100% + 8px));`
    : `left:${x}px; top:${anchoredY}px;`;

  if (contextMenu.kind === 'bookmark') {
    const canPaste = Boolean(contextMenu.target.parentId) && canPasteIntoFolder(contextMenu.target.parentId);
    return `
      <div class="context-menu-layer">
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="Bookmark actions">
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-tab" type="button" role="menuitem">${renderUiIcon('external')}<span>Open in new tab</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-window" type="button" role="menuitem">${renderUiIcon('window')}<span>Open in new window</span></button>
          <div class="bookmark-context-menu__divider"></div>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="cut" type="button" role="menuitem">${renderUiIcon('scissors')}<span>Cut</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="copy" type="button" role="menuitem">${renderUiIcon('copy')}<span>Copy</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="paste" type="button" role="menuitem" ${canPaste ? '' : 'disabled'}>${renderUiIcon('clipboard')}<span>Paste</span></button>
          <div class="bookmark-context-menu__divider"></div>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="edit" type="button" role="menuitem">${renderUiIcon('edit')}<span>Edit...</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="delete" type="button" role="menuitem">${renderUiIcon('trash')}<span>Delete...</span></button>
        </div>
      </div>
    `;
  }

  if (contextMenu.kind === 'folder') {
    const canPaste = canPasteIntoFolder(contextMenu.target.id);
    return `
      <div class="context-menu-layer">
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="Folder actions">
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-tab" type="button" role="menuitem">${renderUiIcon('external')}<span>Open in new tab</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-window" type="button" role="menuitem">${renderUiIcon('window')}<span>Open in new window</span></button>
          <div class="bookmark-context-menu__divider"></div>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="cut" type="button" role="menuitem">${renderUiIcon('scissors')}<span>Cut</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="copy" type="button" role="menuitem">${renderUiIcon('copy')}<span>Copy</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="paste" type="button" role="menuitem" ${canPaste ? '' : 'disabled'}>${renderUiIcon('clipboard')}<span>Paste</span></button>
          <div class="bookmark-context-menu__divider"></div>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="edit-folder" type="button" role="menuitem">${renderUiIcon('edit')}<span>Edit</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="delete-folder" type="button" role="menuitem">${renderUiIcon('trash')}<span>Delete</span></button>
        </div>
      </div>
    `;
  }

  if (contextMenu.kind === 'selection') {
    const summary = [];
    if (contextMenu.target.bookmarkCount) {
      summary.push(`${String(contextMenu.target.bookmarkCount)} bookmark${contextMenu.target.bookmarkCount === 1 ? '' : 's'}`);
    }
    if (contextMenu.target.folderCount) {
      summary.push(`${String(contextMenu.target.folderCount)} folder${contextMenu.target.folderCount === 1 ? '' : 's'}`);
    }

    return `
      <div class="context-menu-layer">
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="Selection actions">
          <p class="bookmark-context-menu__label">${escapeHtml(summary.join(' · ') || 'Selection')}</p>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-tabs" type="button" role="menuitem">${renderUiIcon('external')}<span>Open all links in new tabs</span></button>
          <div class="bookmark-context-menu__divider"></div>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="cut-selection" type="button" role="menuitem">${renderUiIcon('scissors')}<span>Cut</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="copy-selection" type="button" role="menuitem">${renderUiIcon('copy')}<span>Copy</span></button>
          <button class="bookmark-context-menu__item button-with-icon" data-context-action="delete-selection" type="button" role="menuitem">${renderUiIcon('trash')}<span>Delete</span></button>
        </div>
      </div>
    `;
  }

  const canPaste = canPasteIntoFolder(contextMenu.target.id);
  return `
    <div class="context-menu-layer">
      <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="${contextMenu.target.surface === 'dock' ? 'Dock actions' : 'Grid actions'}">
        <button class="bookmark-context-menu__item button-with-icon" data-context-action="add-bookmark" type="button" role="menuitem">${renderUiIcon('plus')}<span>Add Bookmark</span></button>
        <button class="bookmark-context-menu__item button-with-icon" data-context-action="add-folder" type="button" role="menuitem">${renderUiIcon('folderPlus')}<span>Add Folder</span></button>
        <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-manager" type="button" role="menuitem">${renderUiIcon('grid')}<span>Open Bookmark Manager</span></button>
        <div class="bookmark-context-menu__divider"></div>
        <button class="bookmark-context-menu__item button-with-icon" data-context-action="paste" type="button" role="menuitem" ${canPaste ? '' : 'disabled'}>${renderUiIcon('clipboard')}<span>Paste</span></button>
        <div class="bookmark-context-menu__divider"></div>
        <button class="bookmark-context-menu__item button-with-icon" data-context-action="open-settings" type="button" role="menuitem">${renderUiIcon('settings')}<span>Open Settings</span></button>
      </div>
    </div>
  `;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
