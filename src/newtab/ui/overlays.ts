import type { AppState, AppStatus, ContextMenuState } from '../state/app-state';
import { escapeHtml } from '../../shared/html-escape';
import { renderUiIcon } from '../../shared/ui-icons';

export function renderStatusMessage(statusMessage: AppStatus): string {
  return `
    <div class="app-status" data-kind="${statusMessage.kind}" role="status" aria-live="polite">
      <span>${escapeHtml(statusMessage.message)}</span>
      <button class="app-status__dismiss icon-button" type="button" aria-label="Dismiss message">${renderUiIcon('close')}</button>
    </div>
  `;
}

function renderMenuItem(action: string, iconName: Parameters<typeof renderUiIcon>[0], label: string, shortcut = '', disabled = false): string {
  return `<button class="bookmark-context-menu__item button-with-icon" data-context-action="${action}" type="button" role="menuitem" ${disabled ? 'disabled' : ''}>${renderUiIcon(iconName)}<span>${label}</span>${shortcut ? `<span class="bookmark-context-menu__shortcut">${shortcut}</span>` : ''}</button>`;
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
          ${renderMenuItem('open-tab', 'external', 'Open in new tab', 'Ctrl/Cmd+Click')}
          ${renderMenuItem('open-window', 'window', 'Open in new window')}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('cut', 'scissors', 'Cut', 'Ctrl/Cmd+X')}
          ${renderMenuItem('copy', 'copy', 'Copy', 'Ctrl/Cmd+C')}
          ${renderMenuItem('paste', 'clipboard', 'Paste', 'Ctrl/Cmd+V', !canPaste)}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('edit', 'edit', 'Edit...')}
          ${renderMenuItem('delete', 'trash', 'Delete...', 'Delete')}
        </div>
      </div>
    `;
  }

  if (contextMenu.kind === 'folder') {
    const canPaste = canPasteIntoFolder(contextMenu.target.id);
    return `
      <div class="context-menu-layer">
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="Folder actions">
          ${renderMenuItem('open-tab', 'external', 'Open in new tab', 'Ctrl/Cmd+Click')}
          ${renderMenuItem('open-window', 'window', 'Open in new window')}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('cut', 'scissors', 'Cut', 'Ctrl/Cmd+X')}
          ${renderMenuItem('copy', 'copy', 'Copy', 'Ctrl/Cmd+C')}
          ${renderMenuItem('paste', 'clipboard', 'Paste', 'Ctrl/Cmd+V', !canPaste)}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('edit-folder', 'edit', 'Edit')}
          ${renderMenuItem('delete-folder', 'trash', 'Delete', 'Delete')}
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
          ${renderMenuItem('open-tabs', 'external', 'Open all links in new tabs')}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('cut-selection', 'scissors', 'Cut', 'Ctrl/Cmd+X')}
          ${renderMenuItem('copy-selection', 'copy', 'Copy', 'Ctrl/Cmd+C')}
          ${renderMenuItem('delete-selection', 'trash', 'Delete', 'Delete')}
        </div>
      </div>
    `;
  }

  const canPaste = canPasteIntoFolder(contextMenu.target.id);
  return `
    <div class="context-menu-layer">
      <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="${contextMenu.target.surface === 'dock' ? 'Dock actions' : 'Grid actions'}">
        ${renderMenuItem('add-bookmark', 'plus', 'Add Bookmark')}
        ${renderMenuItem('add-folder', 'folderPlus', 'Add Folder')}
        ${renderMenuItem('open-manager', 'grid', 'Open Bookmark Manager')}
        <div class="bookmark-context-menu__divider"></div>
        ${renderMenuItem('paste', 'clipboard', 'Paste', 'Ctrl/Cmd+V', !canPaste)}
        <div class="bookmark-context-menu__divider"></div>
        ${renderMenuItem('open-settings', 'settings', 'Open Settings')}
      </div>
    </div>
  `;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
