import type { AppState, AppStatus, ContextMenuState, SortDropdownState } from '../state/app-state';
import { escapeHtml } from '../../shared/html-escape';
import { renderUiIcon } from '../../shared/ui-icons';
import { t, tp } from '../../shared/i18n';

export function renderStatusMessage(statusMessage: AppStatus): string {
  return `
    <div class="app-status" data-kind="${statusMessage.kind}" role="status" aria-live="polite">
      <span>${escapeHtml(statusMessage.message)}</span>
      <button class="app-status__dismiss icon-button" type="button" aria-label="${t('status.dismiss.aria-label')}">${renderUiIcon('close')}</button>
    </div>
  `;
}

function renderMenuItem(action: string, iconName: Parameters<typeof renderUiIcon>[0], label: string, shortcut = '', disabled = false): string {
  return `<button class="bookmark-context-menu__item button-with-icon" data-context-action="${action}" type="button" role="menuitem" ${disabled ? 'disabled' : ''}>${renderUiIcon(iconName)}<span>${label}</span>${shortcut ? `<span class="bookmark-context-menu__shortcut">${shortcut}</span>` : ''}</button>`;
}

export function renderContextMenu(state: AppState, contextMenu: ContextMenuState, canPasteIntoFolder: (targetFolderId: string) => boolean, showBookmarkManager = true): string {
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
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="${t('context.menu.bookmark.aria-label')}">
          ${renderMenuItem('open-tab', 'external', t('context.menu.open-tab'), t('context.menu.shortcut.ctrl-click'))}
          ${renderMenuItem('open-window', 'window', t('context.menu.open-window'))}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('cut', 'scissors', t('context.menu.cut'), t('context.menu.shortcut.ctrl-x'))}
          ${renderMenuItem('copy', 'copy', t('context.menu.copy'), t('context.menu.shortcut.ctrl-c'))}
          ${renderMenuItem('paste', 'clipboard', t('context.menu.paste'), t('context.menu.shortcut.ctrl-v'), !canPaste)}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('edit', 'edit', t('context.menu.edit'))}
          ${renderMenuItem('delete', 'trash', t('context.menu.delete'), t('context.menu.shortcut.delete'))}
        </div>
      </div>
    `;
  }

  if (contextMenu.kind === 'folder') {
    const canPaste = canPasteIntoFolder(contextMenu.target.id);
    return `
      <div class="context-menu-layer">
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="${t('context.menu.folder.aria-label')}">
          ${renderMenuItem('open-tab', 'external', t('context.menu.open-tab'), t('context.menu.shortcut.ctrl-click'))}
          ${renderMenuItem('open-window', 'window', t('context.menu.open-window'))}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('cut', 'scissors', t('context.menu.cut'), t('context.menu.shortcut.ctrl-x'))}
          ${renderMenuItem('copy', 'copy', t('context.menu.copy'), t('context.menu.shortcut.ctrl-c'))}
          ${renderMenuItem('paste', 'clipboard', t('context.menu.paste'), t('context.menu.shortcut.ctrl-v'), !canPaste)}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('edit-folder', 'edit', t('context.menu.edit'))}
          ${renderMenuItem('delete-folder', 'trash', t('context.menu.delete'), t('context.menu.shortcut.delete'))}
        </div>
      </div>
    `;
  }

  if (contextMenu.kind === 'selection') {
    const summaryParts = [];
    if (contextMenu.target.bookmarkCount) {
      summaryParts.push(tp('context.menu.selection.bookmark-count', contextMenu.target.bookmarkCount, { count: contextMenu.target.bookmarkCount }));
    }
    if (contextMenu.target.folderCount) {
      summaryParts.push(tp('context.menu.selection.folder-count', contextMenu.target.folderCount, { count: contextMenu.target.folderCount }));
    }

    return `
      <div class="context-menu-layer">
        <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="${t('context.menu.selection.aria-label')}">
          <p class="bookmark-context-menu__label">${escapeHtml(summaryParts.join(' · ') || t('context.menu.selection.empty-label'))}</p>
          ${renderMenuItem('open-tabs', 'external', t('context.menu.open-tabs'))}
          <div class="bookmark-context-menu__divider"></div>
          ${renderMenuItem('cut-selection', 'scissors', t('context.menu.cut'), t('context.menu.shortcut.ctrl-x'))}
          ${renderMenuItem('copy-selection', 'copy', t('context.menu.copy'), t('context.menu.shortcut.ctrl-c'))}
          ${renderMenuItem('delete-selection', 'trash', t('context.menu.delete'), t('context.menu.shortcut.delete'))}
        </div>
      </div>
    `;
  }

  const canPaste = canPasteIntoFolder(contextMenu.target.id);
  return `
    <div class="context-menu-layer">
      <div class="bookmark-context-menu" style="${menuStyle}" role="menu" aria-label="${contextMenu.target.surface === 'dock' ? t('context.menu.dock.aria-label') : t('context.menu.grid.aria-label')}">
        ${renderMenuItem('add-bookmark', 'plus', t('context.menu.add-bookmark'))}
        ${renderMenuItem('add-folder', 'folderPlus', t('context.menu.add-folder'))}
        ${showBookmarkManager ? renderMenuItem('open-manager', 'grid', t('context.menu.open-manager')) : ''}
        <div class="bookmark-context-menu__divider"></div>
        ${renderMenuItem('paste', 'clipboard', t('context.menu.paste'), t('context.menu.shortcut.ctrl-v'), !canPaste)}
        <div class="bookmark-context-menu__divider"></div>
        ${renderMenuItem('open-settings', 'settings', t('context.menu.open-settings'))}
      </div>
    </div>
  `;
}

export function renderSortDropdown(sortDropdown: SortDropdownState, currentSortValue: string): string {
  const options: Array<{ value: string; labelKey: Parameters<typeof t>[0] }> = [
    { value: 'manual', labelKey: 'nav.sort.manual' },
    { value: 'name:asc', labelKey: 'nav.sort.name-asc' },
    { value: 'name:desc', labelKey: 'nav.sort.name-desc' },
    { value: 'lastUsed:desc', labelKey: 'nav.sort.last-used-desc' },
    { value: 'lastUsed:asc', labelKey: 'nav.sort.last-used-asc' },
    { value: 'created:desc', labelKey: 'nav.sort.created-desc' },
    { value: 'created:asc', labelKey: 'nav.sort.created-asc' },
  ];
  const panelStyle = sortDropdown.openUpward
    ? `left:${sortDropdown.x}px; bottom:${window.innerHeight - sortDropdown.y}px; min-width:${sortDropdown.width}px;`
    : `left:${sortDropdown.x}px; top:${sortDropdown.y + 4}px; min-width:${sortDropdown.width}px;`;
  const items = options.map(opt => {
    const selected = opt.value === currentSortValue;
    return `<button class="sort-dropdown__option${selected ? ' sort-dropdown__option--selected' : ''}" data-sort-option="${opt.value}" role="option" aria-selected="${selected}" type="button">${selected ? renderUiIcon('check') : '<span class="sort-dropdown__option-spacer" aria-hidden="true"></span>'}<span>${escapeHtml(t(opt.labelKey))}</span></button>`;
  }).join('');
  return `
    <div class="sort-dropdown-layer">
      <div class="sort-dropdown" style="${panelStyle}" role="listbox" aria-label="${t('nav.sort.aria-label')}">
        ${items}
      </div>
    </div>
  `;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
