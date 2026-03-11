import './styles.css';
import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type AppSettings, type BookmarkNode, type CreateBookmarkResponse, type GetBookmarkTreeResponse, type GetSettingsResponse, type InvalidateIconResponse, type MoveBookmarkResponse, type OpenBookmarkManagerResponse, type PatchSettingsResponse, type PingResponse, type RemoveBookmarkResponse, type RemoveIconOverrideResponse, type ResolvedIcon, type SettingsSectionId, type SetIconOverrideResponse, type UpdateBookmarkResponse } from '../shared/messages';
import { createClosedBookmarkDialogState, createInitialAppState, type AppState, type BookmarkClipboardState, type FolderActionTarget, type SelectionContextMenuTarget, type SelectionScope, type SurfaceContextMenuTarget } from './app-state';
import { syncDerivedTree } from './derived-tree';
import { findBookmarkActionTargetById, findNodeById, getBookmarkActionTarget, getBookmarkLabelForUrl, getFolderNode, getHostname, isFolderDescendantOf, resolveInitialFolderId, type BookmarkActionTarget } from './bookmark-navigation';
import { escapeAttribute, escapeHtml } from './html';
import { applyBookmarkDialogCandidate, loadBookmarkDialogPreview, openBookmarkDialog, refreshBookmarkDialogIcon, removeBookmarkDialogOverride, renderBookmarkDialog, saveBookmarkDialogBookmark, searchBookmarkDialog, uploadBookmarkDialogImage } from './bookmark-dialog';
import { hydrateBookmarkIcons, queueVisibleIconPreload } from './icon-runtime';
import { applyPendingIcon, applyResolvedIcon, getFaviconImageUrl, renderFaviconIconMarkup, renderIconPlaceholder, renderResolvedIconMarkup, renderBookmarkVisualIcon } from './icon-render';
import { renderContextMenu, renderStatusMessage } from './overlays';
import { getFolderIdFromHash, getLastFolder, getSearchName, isValidBookmarkUrl, normalizeBackgroundImage, normalizeUploadedImage, openBookmark, openFolderView, persistLastFolder, removeLastFolder, syncFolderHash } from './runtime-helpers';
import { clearSelection, createSelectionContextMenuState, getCurrentFolderChildren, getFolderChildren, getOrderedSelectedIds, getSelectedNodes, isClipboardCutItem, isItemSelected, isSameScope, normalizeSelection, openSelectionInNewTabs } from './selection-state';
import { getFolderActionTarget, setupDockInteractions, setupGridInteractions } from './surface-interactions';
import { cloneBookmarkNode, navigateToFolder, navigateToFolderAndRender, refreshBookmarkTree, refreshTreeAndRender, renderStateAndWarmIcons } from './state-transitions';
import { renderUiIcon } from './ui-icons';
import { buildShellStyle, createAccentPickerState, hslToHex, normalizeGeneralSubpage, normalizeHexColor, normalizeThemeMode, renderDrawerSection, renderSectionButton, resolveAppliedThemeMode, type AccentPickerState, type GeneralSettingsSubpage } from '../settings';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('App root not found.');
}

void bootstrap(root);

async function bootstrap(rootElement: HTMLDivElement): Promise<void> {
  const [ping, settingsResponse, bookmarkResponse] = await Promise.all([
    sendRuntimeMessage<{ type: typeof messageTypes.ping }, PingResponse>({ type: messageTypes.ping }),
    sendRuntimeMessage<{ type: typeof messageTypes.getSettings }, GetSettingsResponse>({ type: messageTypes.getSettings }),
    sendRuntimeMessage<{ type: typeof messageTypes.getBookmarkTree }, GetBookmarkTreeResponse>({ type: messageTypes.getBookmarkTree }),
  ]);

  if (!ping.ok) {
    throw new Error('Background service is unavailable.');
  }

  const state: AppState = createInitialAppState({
    settings: settingsResponse.settings,
    tree: bookmarkResponse.tree,
    getLastFolder,
    getFolderIdFromHash,
  });

  syncFolderHash(state.currentFolderId, 'replace');
  persistLastFolder(state.settings, state.currentFolderId);
  renderApp(rootElement, state);

  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing) {
      return;
    }

    if (handleGlobalKeydown(rootElement, state, event)) {
      event.preventDefault();
    }
  });

  rootElement.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (state.contextMenu && !target.closest('.bookmark-context-menu')) {
      state.contextMenu = null;
      renderApp(rootElement, state);
    }

    void handleDelegatedClick(rootElement, state, event, target);
  });

  rootElement.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    handleDelegatedContextMenu(rootElement, state, event, target);
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.themeMode === 'system') {
      renderApp(rootElement, state);
    }
  });

  window.addEventListener('hashchange', () => {
    const folderId = getFolderIdFromHash();
    if (!folderId || folderId === state.currentFolderId || !getFolderNode(state.tree, folderId)) {
      return;
    }
    if (navigateToFolder(state, folderId, 'none')) {
      renderStateAndWarmIcons(rootElement, state, renderApp);
    }
  });
}

async function applySettingsPatch(rootElement: HTMLDivElement, state: AppState, patch: Partial<AppSettings>): Promise<void> {
  const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
    type: messageTypes.patchSettings,
    patch,
  });

  state.settings = response.settings;
  syncDerivedTree(state);
  state.iconToolTargetUrl = state.derivedTree.linkOptions.some(option => option.url === state.iconToolTargetUrl)
    ? state.iconToolTargetUrl
    : (state.derivedTree.linkOptions[0]?.url ?? '');
  state.accentPicker = {
    ...createAccentPickerState(response.settings.accentColor),
    open: state.accentPicker.open,
  };
  state.drawerOpen = true;

  if (!state.settings.rememberLastFolder) {
    removeLastFolder();
  } else {
    persistLastFolder(state.settings, state.currentFolderId);
  }

  if (response.settings.rootFolderId && !isFolderDescendantOf(state.tree, state.currentFolderId, response.settings.rootFolderId)) {
    navigateToFolder(state, response.settings.rootFolderId, 'replace');
  }

  renderStateAndWarmIcons(rootElement, state, renderApp);
}

async function handleDelegatedClick(rootElement: HTMLDivElement, state: AppState, event: MouseEvent, target: HTMLElement): Promise<void> {
  const homeButton = target.closest<HTMLButtonElement>('.nav-side--left .library-home');
  if (homeButton) {
    const targetId = state.settings.rootFolderId || state.derivedTree.defaultFolder?.id;
    if (targetId) {
      navigateToFolderAndRender(rootElement, state, targetId, renderApp);
    }
    return;
  }

  if (target.closest('.dock-settings-link')) {
    state.generalSubpage = 'dock';
    await switchSettingsSection(rootElement, state, 'general');
    return;
  }

  if (target.closest('.drawer-toggle')) {
    openDrawer(rootElement, state);
    return;
  }

  if (target.closest('.drawer-close, .drawer-scrim')) {
    closeDrawer(rootElement, state);
    return;
  }

  const themeModeButton = target.closest<HTMLButtonElement>('[data-theme-mode-option]');
  if (themeModeButton) {
    const nextMode = normalizeThemeMode(themeModeButton.dataset.themeModeOption);
    await applySettingsPatch(rootElement, state, { themeMode: nextMode });
    return;
  }

  const accentButton = target.closest<HTMLButtonElement>('[data-accent-option]');
  if (accentButton) {
    const accentOption = accentButton.dataset.accentOption;
    if (!accentOption) {
      return;
    }

    if (accentOption === 'custom') {
      state.accentPicker = {
        ...createAccentPickerState(state.settings.accentColor),
        open: !state.accentPicker.open,
      };
      renderApp(rootElement, state);
      return;
    }

    await applySettingsPatch(rootElement, state, { accentColor: accentOption });
    return;
  }

  if (target.closest('.accent-picker-popover__close')) {
    state.accentPicker = {
      ...createAccentPickerState(state.settings.accentColor),
      open: false,
    };
    renderApp(rootElement, state);
    return;
  }

  if (target.closest('.background-upload-button')) {
    rootElement.querySelector<HTMLInputElement>('input[name="customBackgroundImageFile"]')?.click();
    return;
  }

  if (target.closest('.background-remove-button')) {
    if (state.settings.customBackgroundImage) {
      await applySettingsPatch(rootElement, state, { customBackgroundImage: '' });
    }
    return;
  }

  const generalSubpageButton = target.closest<HTMLButtonElement>('[data-general-subpage]');
  if (generalSubpageButton) {
    state.generalSubpage = normalizeGeneralSubpage(generalSubpageButton.dataset.generalSubpage);
    renderApp(rootElement, state);
    return;
  }

  const folderButton = target.closest<HTMLButtonElement>('[data-folder-id]');
  if (folderButton && !folderButton.dataset.gridItemId && !folderButton.dataset.dockItemId) {
    if (folderButton.dataset.suppressClick === 'true') {
      folderButton.dataset.suppressClick = 'false';
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const folderId = folderButton.dataset.folderId;
    if (folderId) {
      navigateToFolderAndRender(rootElement, state, folderId, renderApp);
    }
    return;
  }

  const linkButton = target.closest<HTMLButtonElement>('[data-link-url]');
  if (linkButton && !linkButton.dataset.gridItemId && !linkButton.dataset.dockItemId) {
    if (linkButton.dataset.suppressClick === 'true') {
      linkButton.dataset.suppressClick = 'false';
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      return;
    }

    const url = linkButton.dataset.linkUrl;
    if (url) {
      openBookmark(url, state.settings.openLinksInNewTab);
    }
    return;
  }

  const contextMenuItem = target.closest<HTMLButtonElement>('[data-context-action]');
  if (contextMenuItem) {
    const action = contextMenuItem.dataset.contextAction;
    const menuState = state.contextMenu;
    if (!action || !menuState || contextMenuItem.disabled) {
      return;
    }

    state.contextMenu = null;

    switch (menuState.kind) {
      case 'bookmark':
        await handleBookmarkContextAction(rootElement, state, action, menuState.target);
        return;
      case 'folder':
        await handleFolderContextAction(rootElement, state, action, menuState.target);
        return;
      case 'surface':
        await handleSurfaceContextAction(rootElement, state, action, menuState.target);
        return;
      case 'selection':
        await handleSelectionContextAction(rootElement, state, action, menuState.target);
        return;
    }
  }

  if (target.closest('.app-status__dismiss')) {
    state.statusMessage = null;
    renderApp(rootElement, state);
    return;
  }

  if (target.closest('.icon-upload-trigger')) {
    rootElement.querySelector<HTMLInputElement>('input[name="iconFile"]')?.click();
    return;
  }

  if (target.closest('.icon-remove-button')) {
    const bookmarkUrl = state.iconToolTargetUrl;
    if (!bookmarkUrl) {
      return;
    }

    const bookmarkTitle = getBookmarkLabelForUrl(state.tree, bookmarkUrl);
    await sendRuntimeMessage<{
      type: typeof messageTypes.removeIconOverride;
      bookmarkUrl: string;
      bookmarkTitle?: string;
    }, RemoveIconOverrideResponse>({
      type: messageTypes.removeIconOverride,
      bookmarkUrl,
      bookmarkTitle,
    });

    state.iconToolStatus = `Custom icon removed for ${bookmarkTitle || getHostname(bookmarkUrl)}.`;
    renderApp(rootElement, state);
    return;
  }

  if (target.closest('.icon-refresh-button')) {
    const bookmarkUrl = state.iconToolTargetUrl;
    if (!bookmarkUrl) {
      return;
    }

    const bookmarkTitle = getBookmarkLabelForUrl(state.tree, bookmarkUrl);
    await sendRuntimeMessage<{
      type: typeof messageTypes.invalidateIcon;
      bookmarkUrl: string;
    }, InvalidateIconResponse>({
      type: messageTypes.invalidateIcon,
      bookmarkUrl,
    });

    state.iconToolStatus = `Icon cache refreshed for ${bookmarkTitle || getHostname(bookmarkUrl)}.`;
    renderApp(rootElement, state);
    return;
  }

  if (target.closest('.bookmark-dialog-scrim, .bookmark-dialog-close')) {
    state.bookmarkDialog = createClosedBookmarkDialogState();
    renderApp(rootElement, state);
    return;
  }

  if (target.closest('.bookmark-dialog-search-button')) {
    await searchBookmarkDialog(rootElement, state, state.bookmarkDialog.query, renderApp);
    return;
  }

  if (target.closest('.bookmark-dialog-upload-button')) {
    rootElement.querySelector<HTMLInputElement>('input[name="bookmarkDialogFile"]')?.click();
    return;
  }

  if (target.closest('.bookmark-dialog-refresh-button')) {
    const dialogTarget = state.bookmarkDialog.target;
    if (!dialogTarget) {
      return;
    }

    await sendRuntimeMessage<{
      type: typeof messageTypes.invalidateIcon;
      bookmarkUrl: string;
    }, InvalidateIconResponse>({
      type: messageTypes.invalidateIcon,
      bookmarkUrl: dialogTarget.url,
    });

    await refreshBookmarkDialogIcon(rootElement, state, renderApp);
    return;
  }

  if (target.closest('.bookmark-dialog-remove-button')) {
    const dialogTarget = state.bookmarkDialog.target;
    if (!dialogTarget) {
      return;
    }

    await sendRuntimeMessage<{
      type: typeof messageTypes.removeIconOverride;
      bookmarkUrl: string;
      bookmarkTitle?: string;
    }, RemoveIconOverrideResponse>({
      type: messageTypes.removeIconOverride,
      bookmarkUrl: dialogTarget.url,
      bookmarkTitle: dialogTarget.title,
    });

    await removeBookmarkDialogOverride(rootElement, state, renderApp);
    return;
  }

  const iconCandidateButton = target.closest<HTMLButtonElement>('[data-icon-candidate-url]');
  if (iconCandidateButton) {
    const dialogTarget = state.bookmarkDialog.target;
    const imageUrl = iconCandidateButton.dataset.iconCandidateUrl;
    if (!dialogTarget || !imageUrl) {
      return;
    }

    await applyBookmarkDialogCandidate(rootElement, state, imageUrl, renderApp);
    return;
  }

  const sectionButton = target.closest<HTMLButtonElement>('.section-button');
  if (sectionButton) {
    const section = sectionButton.dataset.section as SettingsSectionId;
    if (section === 'general') {
      state.generalSubpage = 'general';
    }
    await switchSettingsSection(rootElement, state, section);
  }
}

function handleDelegatedContextMenu(rootElement: HTMLDivElement, state: AppState, event: MouseEvent, target: HTMLElement): void {
  const folderCardButton = target.closest<HTMLButtonElement>('.folder-card[data-folder-id]');
  if (folderCardButton && !folderCardButton.dataset.gridItemId && !folderCardButton.dataset.dockItemId) {
    const menuTarget = getFolderActionTarget(folderCardButton);
    if (!menuTarget) {
      return;
    }

    event.preventDefault();
    state.contextMenu = {
      kind: 'folder',
      x: event.clientX,
      y: event.clientY,
      target: menuTarget,
    };
    renderApp(rootElement, state);
    return;
  }

  const linkButton = target.closest<HTMLButtonElement>('[data-link-url]');
  if (linkButton && !linkButton.dataset.gridItemId && !linkButton.dataset.dockItemId) {
    const menuTarget = getBookmarkActionTarget(linkButton);
    if (!menuTarget) {
      return;
    }

    event.preventDefault();
    state.contextMenu = {
      kind: 'bookmark',
      x: event.clientX,
      y: event.clientY,
      target: menuTarget,
    };
    renderApp(rootElement, state);
  }
}

function renderApp(rootElement: HTMLDivElement, state: AppState): void {
  let currentFolder = state.derivedTree.currentFolder;

  if (!currentFolder) {
    rootElement.innerHTML = '<main class="empty-app"><h1>No bookmark folders available</h1><p>The dashboard needs at least one folder to render.</p></main>';
    return;
  }

  if (currentFolder.id !== state.currentFolderId) {
    state.currentFolderId = currentFolder.id;
    syncDerivedTree(state);
    currentFolder = state.derivedTree.currentFolder;
    if (!currentFolder) {
      rootElement.innerHTML = '<main class="empty-app"><h1>No bookmark folders available</h1><p>The dashboard needs at least one folder to render.</p></main>';
      return;
    }
    syncFolderHash(currentFolder.id, 'replace');
    persistLastFolder(state.settings, currentFolder.id);
  }

  const resolvedCurrentFolder = currentFolder;

  const { libraryFolders, breadcrumbs, currentFolderChildren: canvasItems, dockFolder, dockItems, folderOptions } = state.derivedTree;
  const activeSection: SettingsSectionId = state.settings.settingsSection === 'appearance' ? 'appearance' : 'general';
  const themeMode = normalizeThemeMode(state.settings.themeMode);
  const drawerFolderOptions = state.drawerOpen && activeSection === 'general'
    ? folderOptions
    : [];
  const drawerSectionMarkup = state.drawerOpen
    ? renderDrawerSection(activeSection, state.settings, drawerFolderOptions, state.generalSubpage, state.accentPicker)
    : '';

  rootElement.innerHTML = `
    <div class="shell" data-theme-mode="${themeMode}" data-bookmark-icon-surface="${String(state.settings.showBookmarkIconBackground)}" data-dock-visible="${String(state.settings.showDock)}" style="${buildShellStyle(state.settings)}">
      <nav class="bookmarks-navbar" aria-label="Folder path">
        <div class="nav-side nav-side--left">
          <button class="nav-icon library-home button-with-icon" type="button">${renderUiIcon('home')}<span>Home</span></button>
        </div>
        <div class="nav-scroll">
          ${renderNavTrail(libraryFolders, breadcrumbs)}
        </div>
        <div class="nav-side nav-side--right">
          <button class="drawer-toggle nav-icon library-home button-with-icon" type="button" aria-label="Open settings">${renderUiIcon('settings')}<span>Settings</span></button>
        </div>
      </nav>
      <main class="workspace">
        <section class="bookmark-canvas" aria-label="Bookmarks grid">
          <div class="bookmark-grid" data-limit-rows="${String(state.settings.favoritesRows > 0)}">
            ${canvasItems.map((item, index) => renderBookmarkTile(item, state.resolvedIcons, index, isItemSelected(state, item.id, 'grid', resolvedCurrentFolder.id), isClipboardCutItem(state, item.id))).join('') || '<p class="empty-state">This folder is empty.</p>'}
          </div>
          <div class="selection-marquee" hidden aria-hidden="true"></div>
        </section>
        ${state.settings.showDock ? `
          <aside class="bookmark-dock" aria-label="Dock">
            <div class="dock-inner">
              <div class="dock-strip">
                ${dockItems.map((item, index) => renderDockItem(item, state.resolvedIcons, index, isItemSelected(state, item.id, 'dock', dockFolder?.id ?? ''), isClipboardCutItem(state, item.id))).join('') || '<p class="dock-empty">Choose a dock folder in settings.</p>'}
              </div>
              <div class="selection-marquee selection-marquee--dock" hidden aria-hidden="true"></div>
            </div>
          </aside>
        ` : ''}
      </main>
      ${state.drawerOpen ? '<button class="drawer-scrim" type="button" aria-label="Close settings"></button>' : ''}
      <aside class="settings-drawer" data-open="${String(state.drawerOpen)}">
        <div class="drawer-header">
          <div>
            <p class="eyebrow">Settings</p>
            <h2>Workspace controls</h2>
          </div>
          <button class="drawer-close icon-button" type="button" aria-label="Close settings">${renderUiIcon('close')}</button>
        </div>
        <div class="drawer-body">
          <nav class="drawer-nav">
            ${renderSectionButton('general', activeSection, 'General', 'grid')}
            ${renderSectionButton('appearance', activeSection, 'Theme', 'palette')}
          </nav>
          <section class="drawer-section">
            ${drawerSectionMarkup}
          </section>
        </div>
      </aside>
      ${state.statusMessage ? renderStatusMessage(state.statusMessage) : ''}
      ${state.contextMenu ? renderContextMenu(state, state.contextMenu, targetFolderId => canPasteClipboardIntoFolder(state, targetFolderId)) : ''}
      ${state.bookmarkDialog.open ? renderBookmarkDialog(state.bookmarkDialog) : ''}
    </div>
  `;

  const drawer = rootElement.querySelector<HTMLElement>('.settings-drawer');
  const bookmarkCanvas = rootElement.querySelector<HTMLElement>('.bookmark-canvas');
  const useSystemThemeInput = rootElement.querySelector<HTMLInputElement>('input[name="useSystemTheme"]');
  const accentColorInput = rootElement.querySelector<HTMLInputElement>('input[name="accentColor"]');
  const accentHexInput = rootElement.querySelector<HTMLInputElement>('input[name="accentHex"]');
  const customBackgroundImageFileInput = rootElement.querySelector<HTMLInputElement>('input[name="customBackgroundImageFile"]');
  const backgroundOpacityInput = rootElement.querySelector<HTMLInputElement>('input[name="backgroundOpacity"]');
  const backgroundFitModeInput = rootElement.querySelector<HTMLSelectElement>('select[name="backgroundFitMode"]');
  const backgroundPositionModeInput = rootElement.querySelector<HTMLSelectElement>('select[name="backgroundPositionMode"]');
  const accentPickerHueInput = rootElement.querySelector<HTMLInputElement>('input[name="accentPickerHue"]');
  const accentPickerSaturationInput = rootElement.querySelector<HTMLInputElement>('input[name="accentPickerSaturation"]');
  const accentPickerLightnessInput = rootElement.querySelector<HTMLInputElement>('input[name="accentPickerLightness"]');
  const rootFolderInput = rootElement.querySelector<HTMLSelectElement>('select[name="rootFolderId"]');
  const dockFolderInput = rootElement.querySelector<HTMLSelectElement>('select[name="dockFolderId"]');
  const rememberLastFolderInput = rootElement.querySelector<HTMLInputElement>('input[name="rememberLastFolder"]');
  const openLinksInNewTabInput = rootElement.querySelector<HTMLInputElement>('input[name="openLinksInNewTab"]');
  const showDockInput = rootElement.querySelector<HTMLInputElement>('input[name="showDock"]');
  const favoritesColumnsInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesColumns"]');
  const favoritesRowsInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesRows"]');
  const favoritesColumnGapInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesColumnGap"]');
  const favoritesRowGapInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesRowGap"]');
  const bookmarkTileWidthInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkTileWidth"]');
  const bookmarkIconSizeInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkIconSize"]');
  const showBookmarkIconBackgroundInput = rootElement.querySelector<HTMLInputElement>('input[name="showBookmarkIconBackground"]');
  const iconToolTargetInput = rootElement.querySelector<HTMLSelectElement>('select[name="iconToolTargetUrl"]');
  const iconFileInput = rootElement.querySelector<HTMLInputElement>('input[name="iconFile"]');
  const bookmarkDialogSearchInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkDialogSearchQuery"]');
  const bookmarkDialogSearchButton = rootElement.querySelector<HTMLButtonElement>('.bookmark-dialog-search-button');
  const bookmarkDialogTitleInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkDialogTitle"]');
  const bookmarkDialogUrlInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkDialogUrl"]');
  const bookmarkDialogSaveButton = rootElement.querySelector<HTMLButtonElement>('.bookmark-dialog-save-button');
  const bookmarkDialogFileInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkDialogFile"]');
  const bookmarkGrid = rootElement.querySelector<HTMLElement>('.bookmark-grid');
  const bookmarkDock = rootElement.querySelector<HTMLElement>('.bookmark-dock');
  const dockStrip = rootElement.querySelector<HTMLElement>('.dock-strip');

  const applyBookmarkCanvasBackgroundStyle = () => {
    if (!bookmarkCanvas) {
      return;
    }

    const hasCustomBackground = Boolean(state.settings.customBackgroundImage);
    bookmarkCanvas.dataset.hasCustomBackground = String(hasCustomBackground);
    if (hasCustomBackground) {
      bookmarkCanvas.style.setProperty('--bookmark-canvas-bg-image', `url("${escapeCssUrl(state.settings.customBackgroundImage)}")`);
      bookmarkCanvas.style.setProperty('--bookmark-canvas-bg-size', state.settings.backgroundFitMode === 'fill' ? '100% 100%' : state.settings.backgroundFitMode);
      bookmarkCanvas.style.setProperty('--bookmark-canvas-bg-position', state.settings.backgroundPositionMode === 'center' ? 'center center' : `center ${state.settings.backgroundPositionMode}`);
      bookmarkCanvas.style.setProperty('--bookmark-canvas-bg-opacity', String(state.settings.backgroundOpacity / 100));
    } else {
      bookmarkCanvas.style.removeProperty('--bookmark-canvas-bg-image');
      bookmarkCanvas.style.removeProperty('--bookmark-canvas-bg-size');
      bookmarkCanvas.style.removeProperty('--bookmark-canvas-bg-position');
      bookmarkCanvas.style.removeProperty('--bookmark-canvas-bg-opacity');
    }
  };

  applyBookmarkCanvasBackgroundStyle();

  useSystemThemeInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, {
      themeMode: useSystemThemeInput.checked ? 'system' : resolveAppliedThemeMode(state.settings.themeMode),
    });
  });

  accentHexInput?.addEventListener('change', async () => {
    const nextAccent = normalizeHexColor(accentHexInput.value, state.settings.accentColor);
    if (accentHexInput.value.toUpperCase() !== nextAccent) {
      accentHexInput.value = nextAccent;
    }
    state.accentPicker = {
      ...createAccentPickerState(nextAccent),
      open: state.accentPicker.open,
    };
    await applySettingsPatch(rootElement, state, { accentColor: nextAccent });
  });

  accentPickerHueInput?.addEventListener('input', () => {
    updateAccentPickerDraft(rootElement, state, {
      hue: Number(accentPickerHueInput.value),
    });
  });

  accentPickerHueInput?.addEventListener('change', async () => {
    const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
      type: messageTypes.patchSettings,
      patch: { accentColor: state.accentPicker.draftColor },
    });

    state.settings = response.settings;
    state.accentPicker = {
      ...createAccentPickerState(response.settings.accentColor),
      open: true,
    };
  });

  accentPickerSaturationInput?.addEventListener('input', () => {
    updateAccentPickerDraft(rootElement, state, {
      saturation: Number(accentPickerSaturationInput.value),
    });
  });

  accentPickerSaturationInput?.addEventListener('change', async () => {
    const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
      type: messageTypes.patchSettings,
      patch: { accentColor: state.accentPicker.draftColor },
    });

    state.settings = response.settings;
    state.accentPicker = {
      ...createAccentPickerState(response.settings.accentColor),
      open: true,
    };
  });

  accentPickerLightnessInput?.addEventListener('input', () => {
    updateAccentPickerDraft(rootElement, state, {
      lightness: Number(accentPickerLightnessInput.value),
    });
  });

  accentPickerLightnessInput?.addEventListener('change', async () => {
    const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
      type: messageTypes.patchSettings,
      patch: { accentColor: state.accentPicker.draftColor },
    });

    state.settings = response.settings;
    state.accentPicker = {
      ...createAccentPickerState(response.settings.accentColor),
      open: true,
    };
  });

  customBackgroundImageFileInput?.addEventListener('change', async () => {
    const file = customBackgroundImageFileInput.files?.[0];
    if (!file) {
      return;
    }

    const normalizedDataUrl = await normalizeBackgroundImage(file);
    await applySettingsPatch(rootElement, state, { customBackgroundImage: normalizedDataUrl });
    customBackgroundImageFileInput.value = '';
  });

  backgroundOpacityInput?.addEventListener('input', () => {
    const nextOpacity = Math.max(0, Math.min(100, Number(backgroundOpacityInput.value)));
    state.settings.backgroundOpacity = nextOpacity;
    if (bookmarkCanvas) {
      bookmarkCanvas.style.setProperty('--bookmark-canvas-bg-opacity', String(nextOpacity / 100));
    }
  });

  backgroundOpacityInput?.addEventListener('change', async () => {
    const nextOpacity = Math.max(0, Math.min(100, Number(backgroundOpacityInput.value)));
    const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
      type: messageTypes.patchSettings,
      patch: { backgroundOpacity: nextOpacity },
    });

    state.settings = response.settings;
    applyBookmarkCanvasBackgroundStyle();
  });

  backgroundFitModeInput?.addEventListener('change', async () => {
    const nextFitMode = backgroundFitModeInput.value;
    if (nextFitMode !== 'cover' && nextFitMode !== 'contain' && nextFitMode !== 'fill') {
      return;
    }
    await applySettingsPatch(rootElement, state, { backgroundFitMode: nextFitMode });
  });

  backgroundPositionModeInput?.addEventListener('change', async () => {
    const nextPositionMode = backgroundPositionModeInput.value;
    if (nextPositionMode !== 'center' && nextPositionMode !== 'top' && nextPositionMode !== 'bottom') {
      return;
    }
    await applySettingsPatch(rootElement, state, { backgroundPositionMode: nextPositionMode });
  });

  rootFolderInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { rootFolderId: rootFolderInput.value });
  });

  dockFolderInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { dockFolderId: dockFolderInput.value });
  });

  rememberLastFolderInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { rememberLastFolder: rememberLastFolderInput.checked });
  });

  openLinksInNewTabInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { openLinksInNewTab: openLinksInNewTabInput.checked });
  });

  showDockInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { showDock: showDockInput.checked });
  });

  favoritesColumnsInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { favoritesColumns: Number(favoritesColumnsInput.value) });
  });

  favoritesRowsInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { favoritesRows: Number(favoritesRowsInput.value) });
  });

  favoritesColumnGapInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { favoritesColumnGap: Number(favoritesColumnGapInput.value) });
  });

  favoritesRowGapInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { favoritesRowGap: Number(favoritesRowGapInput.value) });
  });

  bookmarkTileWidthInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { bookmarkTileWidth: Number(bookmarkTileWidthInput.value) });
  });

  bookmarkIconSizeInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { bookmarkIconSize: Number(bookmarkIconSizeInput.value) });
  });

  showBookmarkIconBackgroundInput?.addEventListener('change', async () => {
    await applySettingsPatch(rootElement, state, { showBookmarkIconBackground: showBookmarkIconBackgroundInput.checked });
  });

  [
    favoritesColumnsInput,
    favoritesRowsInput,
    favoritesColumnGapInput,
    favoritesRowGapInput,
    bookmarkTileWidthInput,
    bookmarkIconSizeInput,
    backgroundOpacityInput,
  ].forEach(input => {
    if (!input) {
      return;
    }

    syncSliderValueLabel(rootElement, input);
    input.addEventListener('input', () => {
      syncSliderValueLabel(rootElement, input);
    });
  });

  bookmarkCanvas?.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-link-url], .folder-card[data-folder-id]')) {
      return;
    }

    event.preventDefault();
    const gridScope: SelectionScope = { surface: 'grid', folderId: resolvedCurrentFolder.id };
    if (state.selectedIds.length > 1 && isSameScope(state.selectionScope, gridScope)) {
      state.contextMenu = createSelectionContextMenuState(state, event.clientX, event.clientY, gridScope);
      renderApp(rootElement, state);
      return;
    }

    state.contextMenu = {
      kind: 'surface',
      x: event.clientX,
      y: event.clientY,
      target: {
        id: resolvedCurrentFolder.id,
        title: resolvedCurrentFolder.title || 'Untitled',
        surface: 'grid',
      },
    };
    renderApp(rootElement, state);
  });

  bookmarkDock?.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-link-url], .folder-card[data-folder-id]') || !dockFolder) {
      return;
    }

    event.preventDefault();
    const dockScope: SelectionScope = { surface: 'dock', folderId: dockFolder.id };
    if (state.selectedIds.length > 1 && isSameScope(state.selectionScope, dockScope)) {
      state.contextMenu = createSelectionContextMenuState(state, event.clientX, event.clientY, dockScope);
      renderApp(rootElement, state);
      return;
    }

    state.contextMenu = {
      kind: 'surface',
      x: event.clientX,
      y: event.clientY,
      target: {
        id: dockFolder.id,
        title: dockFolder.title || 'Untitled',
        surface: 'dock',
      },
    };
    renderApp(rootElement, state);
  });

  iconToolTargetInput?.addEventListener('change', () => {
    state.iconToolTargetUrl = iconToolTargetInput.value;
    state.iconToolStatus = '';
  });

  iconFileInput?.addEventListener('change', async () => {
    const file = iconFileInput.files?.[0];
    const bookmarkUrl = state.iconToolTargetUrl;
    if (!file || !bookmarkUrl) {
      return;
    }

    const bookmarkTitle = getBookmarkLabelForUrl(state.tree, bookmarkUrl);
    const normalizedDataUrl = await normalizeUploadedImage(file);
    await sendRuntimeMessage<{
      type: typeof messageTypes.setIconOverride;
      bookmarkUrl: string;
      bookmarkTitle?: string;
      dataUrl: string;
      fileName: string;
      mimeType: string;
    }, SetIconOverrideResponse>({
      type: messageTypes.setIconOverride,
      bookmarkUrl,
      bookmarkTitle,
      dataUrl: normalizedDataUrl,
      fileName: file.name,
      mimeType: 'image/png',
    });

    state.iconToolStatus = `Custom icon saved for ${bookmarkTitle || getHostname(bookmarkUrl)}.`;
    iconFileInput.value = '';
    renderApp(rootElement, state);
  });


  bookmarkDialogSearchInput?.addEventListener('input', () => {
    state.bookmarkDialog.query = bookmarkDialogSearchInput.value;
  });

  const updateSaveButtonState = () => {
    const draftTitle = (bookmarkDialogTitleInput?.value ?? state.bookmarkDialog.draftTitle).trim();
    const draftUrl = (bookmarkDialogUrlInput?.value ?? state.bookmarkDialog.draftUrl).trim();
    const canSave = draftTitle.length > 0 && isValidBookmarkUrl(draftUrl);
    if (bookmarkDialogSaveButton) {
      bookmarkDialogSaveButton.disabled = !canSave;
    }
    // Only clear the error toast once all fields are valid again
    if (state.bookmarkDialog.statusKind === 'error' && canSave) {
      state.bookmarkDialog.status = '';
      state.bookmarkDialog.statusKind = '';
      rootElement.querySelector('.bookmark-dialog-toast')?.remove();
    }
  };

  bookmarkDialogTitleInput?.addEventListener('input', () => {
    state.bookmarkDialog.draftTitle = bookmarkDialogTitleInput.value;
    updateSaveButtonState();
  });

  bookmarkDialogTitleInput?.addEventListener('blur', () => {
    if (!bookmarkDialogTitleInput.value.trim()) {
      state.bookmarkDialog.status = 'Name is required.';
      state.bookmarkDialog.statusKind = 'error';
      renderApp(rootElement, state);
    }
  });

  bookmarkDialogUrlInput?.addEventListener('input', () => {
    state.bookmarkDialog.draftUrl = bookmarkDialogUrlInput.value;
    updateSaveButtonState();
  });

  bookmarkDialogUrlInput?.addEventListener('blur', () => {
    const val = bookmarkDialogUrlInput.value.trim();
    if (val && !isValidBookmarkUrl(val)) {
      state.bookmarkDialog.status = 'Enter a valid URL (for example https://example.com).';
      state.bookmarkDialog.statusKind = 'error';
      renderApp(rootElement, state);
    }
  });

  bookmarkDialogSaveButton?.addEventListener('click', async () => {
    await saveBookmarkDialogBookmark(rootElement, state, renderApp);
  });

  bookmarkDialogTitleInput?.addEventListener('keydown', async event => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    await saveBookmarkDialogBookmark(rootElement, state, renderApp);
  });

  bookmarkDialogUrlInput?.addEventListener('keydown', async event => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    await saveBookmarkDialogBookmark(rootElement, state, renderApp);
  });

  bookmarkDialogSearchInput?.addEventListener('keydown', async event => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    await searchBookmarkDialog(rootElement, state, state.bookmarkDialog.query, renderApp);
  });

  bookmarkDialogFileInput?.addEventListener('change', async () => {
    const file = bookmarkDialogFileInput.files?.[0];
    const target = state.bookmarkDialog.target;
    if (!file || !target) {
      return;
    }

    await uploadBookmarkDialogImage(rootElement, state, file, renderApp);
    bookmarkDialogFileInput.value = '';
  });

  setupGridInteractions(rootElement, state, bookmarkCanvas, bookmarkGrid, resolvedCurrentFolder, renderApp);
  setupDockInteractions(rootElement, state, bookmarkDock, dockStrip, dockFolder, renderApp);

  hydrateBookmarkIcons(rootElement, state);
}

async function switchSettingsSection(rootElement: HTMLDivElement, state: AppState, section: SettingsSectionId): Promise<void> {
  const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
    type: messageTypes.patchSettings,
    patch: { settingsSection: section },
  });
  state.settings = response.settings;
  state.drawerOpen = true;
  renderApp(rootElement, state);
}

function dismissTransientUi(rootElement: HTMLDivElement, state: AppState): boolean {
  if (state.bookmarkDialog.open) {
    state.bookmarkDialog = createClosedBookmarkDialogState();
    renderApp(rootElement, state);
    return true;
  }

  if (state.contextMenu) {
    state.contextMenu = null;
    renderApp(rootElement, state);
    return true;
  }

  if (state.accentPicker.open) {
    state.accentPicker = {
      ...createAccentPickerState(state.settings.accentColor),
      open: false,
    };
    renderApp(rootElement, state);
    return true;
  }

  if (state.drawerOpen) {
    closeDrawer(rootElement, state);
    return true;
  }

  if (state.statusMessage) {
    state.statusMessage = null;
    renderApp(rootElement, state);
    return true;
  }

  if (state.selectedIds.length) {
    clearSelection(state);
    renderApp(rootElement, state);
    return true;
  }

  return false;
}

function openDrawer(rootElement: HTMLDivElement, state: AppState): void {
  state.drawerOpen = true;
  renderApp(rootElement, state);
  queueDrawerFocus(rootElement, true);
}

function closeDrawer(rootElement: HTMLDivElement, state: AppState): void {
  const nextAccentPicker = state.accentPicker.open
    ? {
        ...createAccentPickerState(state.settings.accentColor),
        open: false,
      }
    : state.accentPicker;

  state.drawerOpen = false;
  state.accentPicker = nextAccentPicker;
  renderApp(rootElement, state);
  queueDrawerFocus(rootElement, false);
}

function queueDrawerFocus(rootElement: HTMLDivElement, isOpen: boolean): void {
  window.requestAnimationFrame(() => {
    const nextTarget = isOpen
      ? rootElement.querySelector<HTMLButtonElement>('.drawer-close')
      : rootElement.querySelector<HTMLButtonElement>('.drawer-toggle');
    nextTarget?.focus();
  });
}

function handleGlobalKeydown(rootElement: HTMLDivElement, state: AppState, event: KeyboardEvent): boolean {
  if (event.key === 'Escape') {
    return dismissTransientUi(rootElement, state);
  }

  if (state.bookmarkDialog.open || isEditableTarget(event.target)) {
    return false;
  }

  const shortcutKey = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();

  if (shortcutKey && key === 'c' && state.selectedIds.length) {
    setClipboardFromItemIds(state, 'copy', getOrderedSelectedIds(state));
    renderApp(rootElement, state);
    return true;
  }

  if (shortcutKey && key === 'x' && state.selectedIds.length) {
    setClipboardFromItemIds(state, 'cut', getOrderedSelectedIds(state));
    renderApp(rootElement, state);
    return true;
  }

  if (shortcutKey && key === 'v' && state.clipboard) {
    void pasteClipboardIntoFolder(rootElement, state, state.selectionScope?.folderId ?? state.currentFolderId);
    return true;
  }

  if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIds.length) {
    void deleteSelectedItems(rootElement, state, getOrderedSelectedIds(state), state.selectionScope);
    return true;
  }

  return false;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .bookmark-dialog, .settings-drawer'));
}

async function deleteSelectedItems(rootElement: HTMLDivElement, state: AppState, ids: string[], scope: SelectionScope | null = state.selectionScope): Promise<void> {
  const selectedNodes = getSelectedNodes(state, ids, scope);
  if (!selectedNodes.length) {
    renderApp(rootElement, state);
    return;
  }

  const bookmarkCount = selectedNodes.filter(node => Boolean(node.url)).length;
  const folderCount = selectedNodes.length - bookmarkCount;
  const labelParts = [];
  if (bookmarkCount) {
    labelParts.push(`${String(bookmarkCount)} bookmark${bookmarkCount === 1 ? '' : 's'}`);
  }
  if (folderCount) {
    labelParts.push(`${String(folderCount)} folder${folderCount === 1 ? '' : 's'}`);
  }

  const confirmed = window.confirm(`Delete ${labelParts.join(' and ')}?`);
  if (!confirmed) {
    renderApp(rootElement, state);
    return;
  }

  for (const node of selectedNodes) {
    await sendRuntimeMessage<{
      type: typeof messageTypes.removeBookmark;
      bookmarkId: string;
      recursive?: boolean;
    }, RemoveBookmarkResponse>({
      type: messageTypes.removeBookmark,
      bookmarkId: node.id,
      recursive: !node.url,
    });
  }

  clearSelection(state);
  await refreshTreeAndRender(rootElement, state, renderApp, { warmIcons: true });
}

function getDockPreviewItems(node: BookmarkNode): BookmarkNode[] {
  return (node.children ?? []).slice(0, 6);
}

function getFolderPreviewItems(node: BookmarkNode, variant: 'tile' | 'dock'): BookmarkNode[] {
  const limit = variant === 'tile' ? 4 : 6;
  return (node.children ?? []).slice(0, limit);
}

function renderNavTrail(libraryFolders: BookmarkNode[], breadcrumbs: BookmarkNode[]): string {
  if (breadcrumbs.length <= 1) {
    return libraryFolders.map(node => renderLibraryPill(node, breadcrumbs)).join('');
  }
  return breadcrumbs.map(renderBreadcrumb).join('<span class="nav-separator">/</span>');
}

function renderLibraryPill(node: BookmarkNode, breadcrumbs: BookmarkNode[]): string {
  const isActive = breadcrumbs.some(crumb => crumb.id === node.id);
  return `<button class="library-pill" data-folder-id="${node.id}" data-active="${String(isActive)}" type="button">${escapeHtml(node.title || 'Untitled')}</button>`;
}

function renderBreadcrumb(node: BookmarkNode, index: number, items: BookmarkNode[]): string {
  const isLast = index === items.length - 1;
  return `<button class="breadcrumb" data-folder-id="${node.id}" data-last="${String(isLast)}" type="button">${escapeHtml(node.title || 'Untitled')}</button>`;
}

function renderBookmarkTile(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, index: number, selected: boolean, clipboardCut: boolean): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'tile');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';
    return `
      <button class="bookmark-tile link-tile" data-link-url="${escapeAttribute(node.url)}" data-bookmark-id="${node.id}" data-bookmark-title="${escapeAttribute(label)}" data-parent-id="${escapeAttribute(node.parentId ?? '')}" data-grid-item-id="${node.id}" data-grid-item-index="${String(index)}" data-grid-item-kind="bookmark" data-selected="${String(selected)}" data-clipboard-cut="${String(clipboardCut)}" type="button">
        <div class="tile-icon tile-icon--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</div>
        <span class="tile-label">${escapeHtml(label)}</span>
      </button>
    `;
  }

  return renderFolderCard(node, resolvedIcons, 'tile', index, selected, clipboardCut);
}

function renderDockItem(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, index: number, selected: boolean, clipboardCut: boolean): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const meta = getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'dock');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';
    return `
      <button class="dock-item dock-item--link-card" data-link-url="${escapeAttribute(node.url)}" data-bookmark-id="${node.id}" data-bookmark-title="${escapeAttribute(label)}" data-parent-id="${escapeAttribute(node.parentId ?? '')}" data-dock-item-id="${node.id}" data-dock-item-index="${String(index)}" data-dock-item-kind="bookmark" data-selected="${String(selected)}" data-clipboard-cut="${String(clipboardCut)}" type="button">
        <span class="dock-item__preview dock-item__preview--link">
          <span class="dock-item__icon dock-item__icon--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</span>
        </span>
        <span class="dock-item__label">${escapeHtml(label)}</span>
        <span class="dock-item__meta">${escapeHtml(meta)}</span>
      </button>
    `;
  }

  return renderFolderCard(node, resolvedIcons, 'dock', index, selected, clipboardCut);
}

function renderFolderCard(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, variant: 'tile' | 'dock', index?: number, selected = false, clipboardCut = false): string {
  const itemCount = node.children?.length ?? 0;
  const previewItems = getFolderPreviewItems(node, variant);
  const classes = variant === 'tile'
    ? 'bookmark-tile folder-card folder-card--tile'
    : 'dock-item folder-card folder-card--dock';
  const metaMarkup = variant === 'dock'
    ? `<span class="folder-card__meta">${itemCount === 1 ? '1 item' : `${String(itemCount)} items`}</span>`
    : '';

  return `
    <button class="${classes}" data-folder-id="${node.id}" data-folder-title="${escapeAttribute(node.title || 'Untitled')}" data-parent-id="${escapeAttribute(node.parentId ?? '')}" ${variant === 'tile' ? `data-grid-item-id="${node.id}" data-grid-item-index="${String(index ?? 0)}" data-grid-item-kind="folder" data-selected="${String(selected)}" data-clipboard-cut="${String(clipboardCut)}"` : `data-dock-item-id="${node.id}" data-dock-item-index="${String(index ?? 0)}" data-dock-item-kind="folder" data-selected="${String(selected)}" data-clipboard-cut="${String(clipboardCut)}"`} type="button">
      <span class="folder-card__preview">
        <span class="folder-card__grid" data-folder-preview-variant="${variant}">
          ${previewItems.map(child => renderFolderPreviewCell(child, resolvedIcons)).join('') || `<span class="folder-card__cell folder-card__cell--empty">${escapeHtml(getInitial(node.title || 'Folder'))}</span>`}
        </span>
      </span>
      <span class="folder-card__label">${escapeHtml(node.title || 'Untitled')}</span>
      ${metaMarkup}
    </button>
  `;
}

function renderFolderPreviewCell(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'dock');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';

    return `<span class="folder-card__cell folder-card__cell--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</span>`;
  }

  const itemCount = node.children?.length ?? 0;
  return `<span class="folder-card__cell folder-card__cell--folder" title="${escapeAttribute(node.title || 'Folder')}">${itemCount > 0 ? String(itemCount) : escapeHtml(getInitial(node.title || 'Folder'))}</span>`;
}

async function deleteBookmarkFromContext(rootElement: HTMLDivElement, state: AppState, target: BookmarkActionTarget): Promise<void> {
  const confirmed = window.confirm(`Delete ${target.title || getHostname(target.url)}?`);
  if (!confirmed) {
    renderApp(rootElement, state);
    return;
  }

  await sendRuntimeMessage<{
    type: typeof messageTypes.removeBookmark;
    bookmarkId: string;
    recursive?: boolean;
  }, RemoveBookmarkResponse>({
    type: messageTypes.removeBookmark,
    bookmarkId: target.id,
  });

  if (state.bookmarkDialog.target?.id === target.id) {
    state.bookmarkDialog = createClosedBookmarkDialogState();
  }

  await refreshTreeAndRender(rootElement, state, renderApp);
}

async function handleBookmarkContextAction(rootElement: HTMLDivElement, state: AppState, action: string, target: BookmarkActionTarget): Promise<void> {
  switch (action) {
    case 'open-tab':
      openBookmark(target.url, true);
      return;
    case 'open-window':
      window.open(target.url, '_blank', 'noopener,noreferrer,width=1280,height=900');
      return;
    case 'cut':
      setClipboardFromItemIds(state, 'cut', [target.id]);
      renderApp(rootElement, state);
      return;
    case 'copy':
      setClipboardFromItemIds(state, 'copy', [target.id]);
      renderApp(rootElement, state);
      return;
    case 'paste':
      if (target.parentId) {
        await pasteClipboardIntoFolder(rootElement, state, target.parentId);
        return;
      }
      renderApp(rootElement, state);
      return;
    case 'edit':
      await openBookmarkDialog(rootElement, state, target, renderApp);
      return;
    case 'delete':
      await deleteBookmarkFromContext(rootElement, state, target);
      return;
    default:
      renderApp(rootElement, state);
  }
}

async function handleFolderContextAction(rootElement: HTMLDivElement, state: AppState, action: string, target: FolderActionTarget): Promise<void> {
  switch (action) {
    case 'open-tab':
      openFolderView(target.id, true);
      return;
    case 'open-window':
      openFolderView(target.id, false);
      return;
    case 'cut':
      setClipboardFromItemIds(state, 'cut', [target.id]);
      renderApp(rootElement, state);
      return;
    case 'copy':
      setClipboardFromItemIds(state, 'copy', [target.id]);
      renderApp(rootElement, state);
      return;
    case 'paste':
      await pasteClipboardIntoFolder(rootElement, state, target.id);
      return;
    case 'edit-folder':
      await renameFolder(rootElement, state, target);
      return;
    case 'delete-folder':
      await deleteFolderFromContext(rootElement, state, target);
      return;
    default:
      renderApp(rootElement, state);
  }
}

async function handleSurfaceContextAction(rootElement: HTMLDivElement, state: AppState, action: string, target: SurfaceContextMenuTarget): Promise<void> {
  switch (action) {
    case 'add-bookmark':
      await createBookmarkInFolder(rootElement, state, target.id);
      return;
    case 'add-folder':
      await createFolderInFolder(rootElement, state, target.id);
      return;
    case 'open-manager':
      await openBookmarkManager(rootElement, state);
      return;
    case 'paste':
      await pasteClipboardIntoFolder(rootElement, state, target.id);
      return;
    case 'open-settings':
      openDrawer(rootElement, state);
      return;
    default:
      renderApp(rootElement, state);
  }
}

async function handleSelectionContextAction(rootElement: HTMLDivElement, state: AppState, action: string, target: SelectionContextMenuTarget): Promise<void> {
  switch (action) {
    case 'open-tabs':
      openSelectionInNewTabs(state, target.ids, target.scope);
      renderApp(rootElement, state);
      return;
    case 'cut-selection':
      setClipboardFromItemIds(state, 'cut', target.ids);
      renderApp(rootElement, state);
      return;
    case 'copy-selection':
      setClipboardFromItemIds(state, 'copy', target.ids);
      renderApp(rootElement, state);
      return;
    case 'delete-selection':
      await deleteSelectedItems(rootElement, state, target.ids, target.scope);
      return;
    default:
      renderApp(rootElement, state);
  }
}

function setClipboardFromItemIds(state: AppState, mode: BookmarkClipboardState['mode'], bookmarkIds: string[]): void {
  const items = bookmarkIds
    .map(bookmarkId => findNodeById(state.tree, bookmarkId))
    .filter((node): node is BookmarkNode => Boolean(node))
    .map(node => cloneBookmarkNode(node));

  if (!items.length) {
    state.clipboard = null;
    return;
  }

  state.clipboard = {
    mode,
    items,
  };
}

function canPasteClipboardIntoFolder(state: AppState, targetFolderId: string): boolean {
  const clipboard = state.clipboard;
  if (!clipboard) {
    return false;
  }

  if (clipboard.mode === 'cut') {
    if (clipboard.items.every(item => item.parentId === targetFolderId)) {
      return false;
    }

    for (const item of clipboard.items) {
      if (targetFolderId === item.id) {
        return false;
      }

      if (!findNodeById(state.tree, item.id)) {
        return false;
      }

      if (!item.url && isFolderDescendantOf(state.tree, targetFolderId, item.id)) {
        return false;
      }
    }
  }

  return Boolean(getFolderNode(state.tree, targetFolderId));
}

async function createBookmarkInFolder(rootElement: HTMLDivElement, state: AppState, parentId: string): Promise<void> {
  const response = await sendRuntimeMessage<{
    type: typeof messageTypes.createBookmark;
    parentId: string;
    title: string;
    url?: string;
    index?: number;
  }, CreateBookmarkResponse>({
    type: messageTypes.createBookmark,
    parentId,
    title: 'New Bookmark',
    url: 'https://example.com',
  });

  await refreshBookmarkTree(state);
  queueVisibleIconPreload(state);

  const nextTarget = findBookmarkActionTargetById(state.tree, response.bookmark.id);
  if (nextTarget) {
    await openBookmarkDialog(rootElement, state, nextTarget, renderApp);
    return;
  }

  renderApp(rootElement, state);
}

async function createFolderInFolder(rootElement: HTMLDivElement, state: AppState, parentId: string): Promise<void> {
  const nextTitle = window.prompt('Folder name', 'New Folder')?.trim();
  if (!nextTitle) {
    renderApp(rootElement, state);
    return;
  }

  await sendRuntimeMessage<{
    type: typeof messageTypes.createBookmark;
    parentId: string;
    title: string;
    url?: string;
    index?: number;
  }, CreateBookmarkResponse>({
    type: messageTypes.createBookmark,
    parentId,
    title: nextTitle,
  });

  await refreshTreeAndRender(rootElement, state, renderApp, { warmIcons: true });
}

async function renameFolder(rootElement: HTMLDivElement, state: AppState, target: FolderActionTarget): Promise<void> {
  const nextTitle = window.prompt('Folder name', target.title)?.trim();
  if (!nextTitle || nextTitle === target.title) {
    renderApp(rootElement, state);
    return;
  }

  await sendRuntimeMessage<{
    type: typeof messageTypes.updateBookmark;
    bookmarkId: string;
    changes: { title?: string; url?: string };
  }, UpdateBookmarkResponse>({
    type: messageTypes.updateBookmark,
    bookmarkId: target.id,
    changes: { title: nextTitle },
  });

  await refreshTreeAndRender(rootElement, state, renderApp);
}

async function deleteFolderFromContext(rootElement: HTMLDivElement, state: AppState, target: FolderActionTarget): Promise<void> {
  const folder = getFolderNode(state.tree, target.id);
  const itemCount = folder?.children?.length ?? 0;
  const confirmed = window.confirm(`Delete folder ${target.title || 'Untitled'} and its ${String(itemCount)} item${itemCount === 1 ? '' : 's'}?`);
  if (!confirmed) {
    renderApp(rootElement, state);
    return;
  }

  await sendRuntimeMessage<{
    type: typeof messageTypes.removeBookmark;
    bookmarkId: string;
    recursive?: boolean;
  }, RemoveBookmarkResponse>({
    type: messageTypes.removeBookmark,
    bookmarkId: target.id,
    recursive: true,
  });

  if (state.currentFolderId === target.id) {
    state.currentFolderId = target.parentId || resolveInitialFolderId(state.settings, state.tree, getLastFolder, getFolderIdFromHash);
  }

  await refreshTreeAndRender(rootElement, state, renderApp, { warmIcons: true });
}

async function pasteClipboardIntoFolder(rootElement: HTMLDivElement, state: AppState, targetFolderId: string): Promise<void> {
  if (!canPasteClipboardIntoFolder(state, targetFolderId) || !state.clipboard) {
    renderApp(rootElement, state);
    return;
  }

  if (state.clipboard.mode === 'cut') {
    const targetFolder = getFolderNode(state.tree, targetFolderId);
    let nextIndex = targetFolder?.children?.length ?? 0;

    for (const item of state.clipboard.items) {
      await sendRuntimeMessage<{
        type: typeof messageTypes.moveBookmark;
        bookmarkId: string;
        parentId: string;
        index?: number;
      }, MoveBookmarkResponse>({
        type: messageTypes.moveBookmark,
        bookmarkId: item.id,
        parentId: targetFolderId,
        index: nextIndex,
      });
      nextIndex += 1;
    }

    state.clipboard = null;
  } else {
    const targetFolder = getFolderNode(state.tree, targetFolderId);
    let nextIndex = targetFolder?.children?.length ?? 0;

    for (const item of state.clipboard.items) {
      await cloneBookmarkSubtree(targetFolderId, item, nextIndex);
      nextIndex += 1;
    }
  }

  await refreshTreeAndRender(rootElement, state, renderApp, { warmIcons: true });
}

async function cloneBookmarkSubtree(parentId: string, sourceNode: BookmarkNode, index?: number): Promise<void> {
  if (sourceNode.url) {
    await sendRuntimeMessage<{
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
    return;
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
    if (child.url) {
      await sendRuntimeMessage<{
        type: typeof messageTypes.createBookmark;
        parentId: string;
        title: string;
        url?: string;
        index?: number;
      }, CreateBookmarkResponse>({
        type: messageTypes.createBookmark,
        parentId: response.bookmark.id,
        title: child.title || getHostname(child.url),
        url: child.url,
      });
      continue;
    }

    await cloneBookmarkSubtree(response.bookmark.id, child);
  }
}

async function openBookmarkManager(rootElement: HTMLDivElement, state: AppState): Promise<void> {
  const response = await sendRuntimeMessage<{ type: typeof messageTypes.openBookmarkManager }, OpenBookmarkManagerResponse>({
    type: messageTypes.openBookmarkManager,
  });

  if (!response.opened) {
    state.statusMessage = {
      kind: 'error',
      message: response.message || 'The browser blocked the native bookmark manager page.',
    };
    renderApp(rootElement, state);
    return;
  }

  state.statusMessage = null;
}

function getInitial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed[0].toUpperCase() : 'â€¢';
}

function escapeCssUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function updateAccentPickerDraft(rootElement: HTMLDivElement, state: AppState, patch: Partial<Pick<AccentPickerState, 'hue' | 'saturation' | 'lightness'>>): void {
  const nextState: AccentPickerState = {
    ...state.accentPicker,
    open: true,
    hue: patch.hue === undefined ? state.accentPicker.hue : clamp(patch.hue, 0, 360),
    saturation: patch.saturation === undefined ? state.accentPicker.saturation : clamp(patch.saturation, 0, 100),
    lightness: patch.lightness === undefined ? state.accentPicker.lightness : clamp(patch.lightness, 0, 100),
    draftColor: state.accentPicker.draftColor,
  };
  nextState.draftColor = hslToHex(nextState.hue, nextState.saturation, nextState.lightness);
  state.accentPicker = nextState;

  const accentHexInput = rootElement.querySelector<HTMLInputElement>('input[name="accentHex"]');
  const accentColorInput = rootElement.querySelector<HTMLInputElement>('input[name="accentColor"]');
  const preview = rootElement.querySelector<HTMLElement>('.accent-picker-popover__preview');
  const shell = rootElement.querySelector<HTMLElement>('.shell');

  if (accentHexInput) {
    accentHexInput.value = nextState.draftColor;
  }

  if (accentColorInput) {
    accentColorInput.value = nextState.draftColor;
  }

  if (preview) {
    preview.style.background = nextState.draftColor;
  }

  if (shell) {
    shell.setAttribute('style', buildShellStyle({
      ...state.settings,
      accentColor: nextState.draftColor,
    }));
  }

  syncAccentSliderValue(rootElement, 'accentPickerHue', `${String(Math.round(nextState.hue))}deg`);
  syncAccentSliderValue(rootElement, 'accentPickerSaturation', `${String(Math.round(nextState.saturation))}%`);
  syncAccentSliderValue(rootElement, 'accentPickerLightness', `${String(Math.round(nextState.lightness))}%`);
}

function syncAccentSliderValue(rootElement: HTMLDivElement, name: string, value: string): void {
  const valueLabel = rootElement.querySelector<HTMLElement>(`[data-slider-value-for="${name}"]`);
  if (valueLabel) {
    valueLabel.textContent = value;
  }
}

function syncSliderValueLabel(rootElement: HTMLDivElement, input: HTMLInputElement): void {
  const valueLabel = rootElement.querySelector<HTMLElement>(`[data-slider-value-for="${input.name}"]`);
  if (!valueLabel) {
    return;
  }

  const suffix = input.name === 'favoritesColumns' || input.name === 'favoritesRows'
    ? ''
    : input.name === 'backgroundOpacity'
      ? '%'
    : input.name === 'accentPickerHue'
      ? 'deg'
      : input.name.startsWith('accentPicker')
        ? '%'
        : 'px';
  valueLabel.textContent = `${input.value}${suffix}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
