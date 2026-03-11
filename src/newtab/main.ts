import './styles.css';
import { extensionApi, sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type AppSettings, type BookmarkNode, type CreateBookmarkResponse, type GetBookmarkTreeResponse, type GetIconResponse, type GetSettingsResponse, type IconSearchCandidate, type InvalidateIconResponse, type MoveBookmarkResponse, type OpenBookmarkManagerResponse, type PatchSettingsResponse, type PingResponse, type RemoveBookmarkResponse, type RemoveIconOverrideResponse, type ResolvedIcon, type SearchIconsResponse, type SettingsSectionId, type SetIconOverrideFromUrlResponse, type SetIconOverrideResponse, type UpdateBookmarkResponse } from '../shared/messages';
import { collectFolderOptions, collectLinkOptions, collectVisibleBookmarks as collectVisibleBookmarkTargets, findBookmarkActionTargetById, findNodeById, getBookmarkActionTarget, getBookmarkLabelForUrl, getBreadcrumbs, getDefaultFolder, getDockFolder, getFolderNode, getHostname, getLibraryFolders, isFolderDescendantOf, resolveInitialFolderId, resolveInitialIconToolTarget, resolveIconToolTarget, type BookmarkActionTarget } from './bookmark-navigation';
import { escapeAttribute, escapeHtml } from './html';
import { applyPendingIcon, applyResolvedIcon, getFaviconImageUrl, renderFaviconIconMarkup, renderIconPlaceholder, renderResolvedIconMarkup, renderBookmarkVisualIcon } from './icon-render';
import { renderUiIcon } from './ui-icons';
import { buildShellStyle, createAccentPickerState, hslToHex, normalizeGeneralSubpage, normalizeHexColor, normalizeThemeMode, renderDrawerSection, renderSectionButton, resolveAppliedThemeMode, type AccentPickerState, type GeneralSettingsSubpage } from '../settings';

const root = document.querySelector<HTMLDivElement>('#app');
const lastFolderStorageKey = 'newtab/last-folder';

interface AppState {
  settings: AppSettings;
  tree: BookmarkNode[];
  currentFolderId: string;
  drawerOpen: boolean;
  generalSubpage: GeneralSettingsSubpage;
  accentPicker: AccentPickerState;
  iconToolTargetUrl: string;
  iconToolStatus: string;
  clipboard: BookmarkClipboardState | null;
  contextMenu: ContextMenuState | null;
  iconDialog: IconDialogState;
  resolvedIcons: Record<string, ResolvedIcon>;
  selectedIds: string[];
  selectionAnchorId: string | null;
  selectionScope: SelectionScope | null;
  statusMessage: AppStatus | null;
}

type BookmarkItemKind = 'bookmark' | 'folder';

type SelectionSurface = 'grid' | 'dock';

interface SelectionScope {
  surface: SelectionSurface;
  folderId: string;
}

interface FolderActionTarget {
  id: string;
  title: string;
  parentId: string;
}

interface SurfaceContextMenuTarget {
  id: string;
  title: string;
  surface: 'grid' | 'dock';
}

interface BookmarkContextMenuState {
  kind: 'bookmark';
  x: number;
  y: number;
  target: BookmarkActionTarget;
}

interface FolderContextMenuState {
  kind: 'folder';
  x: number;
  y: number;
  target: FolderActionTarget;
}

interface SurfaceContextMenuState {
  kind: 'surface';
  x: number;
  y: number;
  target: SurfaceContextMenuTarget;
}

interface SelectionContextMenuState {
  kind: 'selection';
  x: number;
  y: number;
  target: SelectionContextMenuTarget;
}

type ContextMenuState = BookmarkContextMenuState | FolderContextMenuState | SurfaceContextMenuState | SelectionContextMenuState;

interface SelectionContextMenuTarget {
  ids: string[];
  bookmarkCount: number;
  folderCount: number;
  scope: SelectionScope | null;
}

interface BookmarkClipboardState {
  mode: 'copy' | 'cut';
  items: BookmarkNode[];
}

interface AppStatus {
  message: string;
  kind: 'error' | 'success' | 'info';
}

interface IconDialogState {
  open: boolean;
  target: BookmarkActionTarget | null;
  draftTitle: string;
  draftUrl: string;
  query: string;
  status: string;
  statusKind: 'error' | 'success' | 'info' | '';
  loading: boolean;
  results: IconSearchCandidate[];
  previewIcon: ResolvedIcon | null;
}

let iconRenderGeneration = 0;

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

  const state: AppState = {
    settings: settingsResponse.settings,
    tree: bookmarkResponse.tree,
    currentFolderId: resolveInitialFolderId(settingsResponse.settings, bookmarkResponse.tree, getLastFolder, getFolderIdFromHash),
    drawerOpen: false,
    generalSubpage: 'general',
    accentPicker: createAccentPickerState(settingsResponse.settings.accentColor),
    iconToolTargetUrl: resolveInitialIconToolTarget(bookmarkResponse.tree),
    iconToolStatus: '',
    clipboard: null,
    contextMenu: null,
    iconDialog: createClosedIconDialogState(),
    resolvedIcons: {},
    selectedIds: [],
    selectionAnchorId: null,
    selectionScope: null,
    statusMessage: null,
  };

  syncFolderHash(state.currentFolderId);
  persistLastFolder(state.settings, state.currentFolderId);
  await preloadVisibleIcons(state);
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
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.settings.themeMode === 'system') {
      renderApp(rootElement, state);
    }
  });

  window.addEventListener('hashchange', async () => {
    const folderId = getFolderIdFromHash();
    if (!folderId || folderId === state.currentFolderId || !getFolderNode(state.tree, folderId)) {
      return;
    }
    state.currentFolderId = folderId;
    clearSelection(state);
    persistLastFolder(state.settings, folderId);
    await preloadVisibleIcons(state);
    renderApp(rootElement, state);
  });
}

function renderApp(rootElement: HTMLDivElement, state: AppState): void {
  const currentFolder = getFolderNode(state.tree, state.currentFolderId) ?? getDefaultFolder(state.tree, state.settings.rootFolderId);

  if (!currentFolder) {
    rootElement.innerHTML = '<main class="empty-app"><h1>No bookmark folders available</h1><p>The dashboard needs at least one folder to render.</p></main>';
    return;
  }

  if (currentFolder.id !== state.currentFolderId) {
    state.currentFolderId = currentFolder.id;
    syncFolderHash(currentFolder.id);
    persistLastFolder(state.settings, currentFolder.id);
  }

  const allFolderOptions = collectFolderOptions(state.tree);
  const libraryFolders = getLibraryFolders(state.tree);
  const breadcrumbs = getBreadcrumbs(state.tree, currentFolder.id);
  const canvasItems = currentFolder.children ?? [];
  const dockFolder = getDockFolder(state.tree, state.settings);
  const dockItems = dockFolder?.children ?? [];
  const activeSection: SettingsSectionId = state.settings.settingsSection === 'appearance' ? 'appearance' : 'general';
  const themeMode = normalizeThemeMode(state.settings.themeMode);

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
            ${canvasItems.map((item, index) => renderBookmarkTile(item, state.resolvedIcons, index, isItemSelected(state, item.id, 'grid', currentFolder.id))).join('') || '<p class="empty-state">This folder is empty.</p>'}
          </div>
          <div class="selection-marquee" hidden aria-hidden="true"></div>
        </section>
        ${state.settings.showDock ? `
          <aside class="bookmark-dock" aria-label="Dock">
            <div class="dock-inner">
              <div class="dock-strip">
                ${dockItems.map((item, index) => renderDockItem(item, state.resolvedIcons, index, isItemSelected(state, item.id, 'dock', dockFolder?.id ?? ''))).join('') || '<p class="dock-empty">Choose a dock folder in settings.</p>'}
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
            ${renderDrawerSection(activeSection, state.settings, allFolderOptions, state.generalSubpage, state.accentPicker)}
          </section>
        </div>
      </aside>
      ${state.statusMessage ? renderStatusMessage(state.statusMessage) : ''}
      ${state.contextMenu ? renderContextMenu(state, state.contextMenu) : ''}
      ${state.iconDialog.open ? renderIconDialog(state.iconDialog) : ''}
    </div>
  `;

  const drawer = rootElement.querySelector<HTMLElement>('.settings-drawer');
  const bookmarkCanvas = rootElement.querySelector<HTMLElement>('.bookmark-canvas');
  const homeButton = rootElement.querySelector<HTMLButtonElement>('.library-home');
  const dockSettingsButton = rootElement.querySelector<HTMLButtonElement>('.dock-settings-link');
  const drawerScrim = rootElement.querySelector<HTMLButtonElement>('.drawer-scrim');
  const toggleButton = rootElement.querySelector<HTMLButtonElement>('.drawer-toggle');
  const closeButton = rootElement.querySelector<HTMLButtonElement>('.drawer-close');
  const sectionButtons = rootElement.querySelectorAll<HTMLButtonElement>('.section-button');
  const useSystemThemeInput = rootElement.querySelector<HTMLInputElement>('input[name="useSystemTheme"]');
  const accentColorInput = rootElement.querySelector<HTMLInputElement>('input[name="accentColor"]');
  const accentHexInput = rootElement.querySelector<HTMLInputElement>('input[name="accentHex"]');
  const customBackgroundImageFileInput = rootElement.querySelector<HTMLInputElement>('input[name="customBackgroundImageFile"]');
  const backgroundOpacityInput = rootElement.querySelector<HTMLInputElement>('input[name="backgroundOpacity"]');
  const backgroundFitModeInput = rootElement.querySelector<HTMLSelectElement>('select[name="backgroundFitMode"]');
  const backgroundPositionModeInput = rootElement.querySelector<HTMLSelectElement>('select[name="backgroundPositionMode"]');
  const backgroundUploadButton = rootElement.querySelector<HTMLButtonElement>('.background-upload-button');
  const backgroundRemoveButton = rootElement.querySelector<HTMLButtonElement>('.background-remove-button');
  const accentPickerClose = rootElement.querySelector<HTMLButtonElement>('.accent-picker-popover__close');
  const accentPickerHueInput = rootElement.querySelector<HTMLInputElement>('input[name="accentPickerHue"]');
  const accentPickerSaturationInput = rootElement.querySelector<HTMLInputElement>('input[name="accentPickerSaturation"]');
  const accentPickerLightnessInput = rootElement.querySelector<HTMLInputElement>('input[name="accentPickerLightness"]');
  const rootFolderInput = rootElement.querySelector<HTMLSelectElement>('select[name="rootFolderId"]');
  const dockFolderInput = rootElement.querySelector<HTMLSelectElement>('select[name="dockFolderId"]');
  const rememberLastFolderInput = rootElement.querySelector<HTMLInputElement>('input[name="rememberLastFolder"]');
  const openLinksInNewTabInput = rootElement.querySelector<HTMLInputElement>('input[name="openLinksInNewTab"]');
  const showDockInput = rootElement.querySelector<HTMLInputElement>('input[name="showDock"]');
  const generalSubpageButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-general-subpage]');
  const favoritesColumnsInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesColumns"]');
  const favoritesRowsInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesRows"]');
  const favoritesColumnGapInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesColumnGap"]');
  const favoritesRowGapInput = rootElement.querySelector<HTMLInputElement>('input[name="favoritesRowGap"]');
  const bookmarkTileWidthInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkTileWidth"]');
  const bookmarkIconSizeInput = rootElement.querySelector<HTMLInputElement>('input[name="bookmarkIconSize"]');
  const showBookmarkIconBackgroundInput = rootElement.querySelector<HTMLInputElement>('input[name="showBookmarkIconBackground"]');
  const iconToolTargetInput = rootElement.querySelector<HTMLSelectElement>('select[name="iconToolTargetUrl"]');
  const iconFileInput = rootElement.querySelector<HTMLInputElement>('input[name="iconFile"]');
  const iconUploadTrigger = rootElement.querySelector<HTMLButtonElement>('.icon-upload-trigger');
  const iconRemoveButton = rootElement.querySelector<HTMLButtonElement>('.icon-remove-button');
  const iconRefreshButton = rootElement.querySelector<HTMLButtonElement>('.icon-refresh-button');
  const appStatusDismissButton = rootElement.querySelector<HTMLButtonElement>('.app-status__dismiss');
  const contextMenuItems = rootElement.querySelectorAll<HTMLButtonElement>('[data-context-action]');
  const iconDialogDismiss = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-scrim');
  const iconDialogClose = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-close');
  const iconDialogSearchInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogSearchQuery"]');
  const iconDialogSearchButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-search-button');
  const iconDialogTitleInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogTitle"]');
  const iconDialogUrlInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogUrl"]');
  const iconDialogSaveButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-save-button');
  const iconDialogUploadButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-upload-button');
  const iconDialogFileInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogFile"]');
  const iconDialogRefreshButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-refresh-button');
  const iconDialogRemoveButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-remove-button');
  const iconDialogResultButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-icon-candidate-url]');
  const themeModeButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-theme-mode-option]');
  const accentButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-accent-option]');
  const bookmarkGrid = rootElement.querySelector<HTMLElement>('.bookmark-grid');
  const bookmarkDock = rootElement.querySelector<HTMLElement>('.bookmark-dock');
  const dockStrip = rootElement.querySelector<HTMLElement>('.dock-strip');
  const folderButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-folder-id]');
  const folderCardButtons = rootElement.querySelectorAll<HTMLButtonElement>('.folder-card[data-folder-id]');
  const linkButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-link-url]');

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

  const applySettingsPatch = async (patch: Partial<AppSettings>) => {
    const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
      type: messageTypes.patchSettings,
      patch,
    });

    state.settings = response.settings;
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
      state.currentFolderId = response.settings.rootFolderId;
      clearSelection(state);
      syncFolderHash(state.currentFolderId);
      persistLastFolder(state.settings, state.currentFolderId);
    }

    await preloadVisibleIcons(state);
    renderApp(rootElement, state);
  };

  homeButton?.addEventListener('click', async () => {
    const targetId = state.settings.rootFolderId || getDefaultFolder(state.tree, state.settings.rootFolderId)?.id;
    if (!targetId) {
      return;
    }
    navigateToFolder(state, targetId);
    await preloadVisibleIcons(state);
    renderApp(rootElement, state);
  });

  dockSettingsButton?.addEventListener('click', async () => {
    state.generalSubpage = 'dock';
    await switchSettingsSection(rootElement, state, 'general');
  });

  toggleButton?.addEventListener('click', () => openDrawer(rootElement, state));
  closeButton?.addEventListener('click', () => closeDrawer(rootElement, state));

  drawerScrim?.addEventListener('click', () => closeDrawer(rootElement, state));

  themeModeButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const nextMode = normalizeThemeMode(button.dataset.themeModeOption);
      await applySettingsPatch({ themeMode: nextMode });
    });
  });

  useSystemThemeInput?.addEventListener('change', async () => {
    await applySettingsPatch({
      themeMode: useSystemThemeInput.checked ? 'system' : resolveAppliedThemeMode(state.settings.themeMode),
    });
  });

  accentButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const accentOption = button.dataset.accentOption;
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

      await applySettingsPatch({ accentColor: accentOption });
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
    await applySettingsPatch({ accentColor: nextAccent });
  });

  accentPickerClose?.addEventListener('click', () => {
    state.accentPicker = {
      ...createAccentPickerState(state.settings.accentColor),
      open: false,
    };
    renderApp(rootElement, state);
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

  backgroundUploadButton?.addEventListener('click', () => {
    customBackgroundImageFileInput?.click();
  });

  customBackgroundImageFileInput?.addEventListener('change', async () => {
    const file = customBackgroundImageFileInput.files?.[0];
    if (!file) {
      return;
    }

    const normalizedDataUrl = await normalizeBackgroundImage(file);
    await applySettingsPatch({ customBackgroundImage: normalizedDataUrl });
    customBackgroundImageFileInput.value = '';
  });

  backgroundRemoveButton?.addEventListener('click', async () => {
    if (!state.settings.customBackgroundImage) {
      return;
    }
    await applySettingsPatch({ customBackgroundImage: '' });
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
    await applySettingsPatch({ backgroundFitMode: nextFitMode });
  });

  backgroundPositionModeInput?.addEventListener('change', async () => {
    const nextPositionMode = backgroundPositionModeInput.value;
    if (nextPositionMode !== 'center' && nextPositionMode !== 'top' && nextPositionMode !== 'bottom') {
      return;
    }
    await applySettingsPatch({ backgroundPositionMode: nextPositionMode });
  });

  rootFolderInput?.addEventListener('change', async () => {
    await applySettingsPatch({ rootFolderId: rootFolderInput.value });
  });

  dockFolderInput?.addEventListener('change', async () => {
    await applySettingsPatch({ dockFolderId: dockFolderInput.value });
  });

  rememberLastFolderInput?.addEventListener('change', async () => {
    await applySettingsPatch({ rememberLastFolder: rememberLastFolderInput.checked });
  });

  openLinksInNewTabInput?.addEventListener('change', async () => {
    await applySettingsPatch({ openLinksInNewTab: openLinksInNewTabInput.checked });
  });

  showDockInput?.addEventListener('change', async () => {
    await applySettingsPatch({ showDock: showDockInput.checked });
  });

  favoritesColumnsInput?.addEventListener('change', async () => {
    await applySettingsPatch({ favoritesColumns: Number(favoritesColumnsInput.value) });
  });

  favoritesRowsInput?.addEventListener('change', async () => {
    await applySettingsPatch({ favoritesRows: Number(favoritesRowsInput.value) });
  });

  favoritesColumnGapInput?.addEventListener('change', async () => {
    await applySettingsPatch({ favoritesColumnGap: Number(favoritesColumnGapInput.value) });
  });

  favoritesRowGapInput?.addEventListener('change', async () => {
    await applySettingsPatch({ favoritesRowGap: Number(favoritesRowGapInput.value) });
  });

  bookmarkTileWidthInput?.addEventListener('change', async () => {
    await applySettingsPatch({ bookmarkTileWidth: Number(bookmarkTileWidthInput.value) });
  });

  bookmarkIconSizeInput?.addEventListener('change', async () => {
    await applySettingsPatch({ bookmarkIconSize: Number(bookmarkIconSizeInput.value) });
  });

  showBookmarkIconBackgroundInput?.addEventListener('change', async () => {
    await applySettingsPatch({ showBookmarkIconBackground: showBookmarkIconBackgroundInput.checked });
  });

  generalSubpageButtons.forEach(button => {
    button.addEventListener('click', () => {
      state.generalSubpage = normalizeGeneralSubpage(button.dataset.generalSubpage);
      renderApp(rootElement, state);
    });
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

  folderButtons.forEach(button => {
    button.addEventListener('click', async event => {
      if (button.dataset.gridItemId || button.dataset.dockItemId) {
        return;
      }

      if (button.dataset.suppressClick === 'true') {
        button.dataset.suppressClick = 'false';
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      const folderId = button.dataset.folderId;
      if (!folderId) {
        return;
      }
      navigateToFolder(state, folderId);
      await preloadVisibleIcons(state);
      renderApp(rootElement, state);
    });
  });

  folderCardButtons.forEach(button => {
    button.addEventListener('contextmenu', event => {
      if (button.dataset.gridItemId || button.dataset.dockItemId) {
        return;
      }

      const target = getFolderActionTarget(button);
      if (!target) {
        return;
      }

      event.preventDefault();
      state.contextMenu = {
        kind: 'folder',
        x: event.clientX,
        y: event.clientY,
        target,
      };
      renderApp(rootElement, state);
    });
  });

  linkButtons.forEach(button => {
    button.addEventListener('click', event => {
      if (button.dataset.gridItemId || button.dataset.dockItemId) {
        return;
      }

      if (button.dataset.suppressClick === 'true') {
        button.dataset.suppressClick = 'false';
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.metaKey || event.ctrlKey) {
        return;
      }

      const url = button.dataset.linkUrl;
      if (!url) {
        return;
      }
      openBookmark(url, state.settings.openLinksInNewTab);
    });

    button.addEventListener('contextmenu', event => {
      if (button.dataset.gridItemId || button.dataset.dockItemId) {
        return;
      }

      const target = getBookmarkActionTarget(button);
      if (!target) {
        return;
      }
      event.preventDefault();
      state.contextMenu = {
        kind: 'bookmark',
        x: event.clientX,
        y: event.clientY,
        target,
      };
      renderApp(rootElement, state);
    });
  });

  bookmarkCanvas?.addEventListener('contextmenu', event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-link-url], .folder-card[data-folder-id]')) {
      return;
    }

    event.preventDefault();
    const gridScope: SelectionScope = { surface: 'grid', folderId: currentFolder.id };
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
        id: currentFolder.id,
        title: currentFolder.title || 'Untitled',
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

  contextMenuItems.forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.contextAction;
      const menuState = state.contextMenu;
      if (!action || !menuState || button.disabled) {
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
    });
  });

  appStatusDismissButton?.addEventListener('click', () => {
    state.statusMessage = null;
    renderApp(rootElement, state);
  });

  iconToolTargetInput?.addEventListener('change', () => {
    state.iconToolTargetUrl = iconToolTargetInput.value;
    state.iconToolStatus = '';
  });

  iconUploadTrigger?.addEventListener('click', () => {
    iconFileInput?.click();
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

  iconRemoveButton?.addEventListener('click', async () => {
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
  });

  iconRefreshButton?.addEventListener('click', async () => {
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
  });

  iconDialogDismiss?.addEventListener('click', () => {
    state.iconDialog = createClosedIconDialogState();
    renderApp(rootElement, state);
  });

  iconDialogClose?.addEventListener('click', () => {
    state.iconDialog = createClosedIconDialogState();
    renderApp(rootElement, state);
  });

  iconDialogSearchInput?.addEventListener('input', () => {
    state.iconDialog.query = iconDialogSearchInput.value;
  });

  const updateSaveButtonState = () => {
    const draftTitle = (iconDialogTitleInput?.value ?? state.iconDialog.draftTitle).trim();
    const draftUrl = (iconDialogUrlInput?.value ?? state.iconDialog.draftUrl).trim();
    const canSave = draftTitle.length > 0 && isValidBookmarkUrl(draftUrl);
    if (iconDialogSaveButton) {
      iconDialogSaveButton.disabled = !canSave;
    }
    // Only clear the error toast once all fields are valid again
    if (state.iconDialog.statusKind === 'error' && canSave) {
      state.iconDialog.status = '';
      state.iconDialog.statusKind = '';
      rootElement.querySelector('.icon-dialog-toast')?.remove();
    }
  };

  iconDialogTitleInput?.addEventListener('input', () => {
    state.iconDialog.draftTitle = iconDialogTitleInput.value;
    updateSaveButtonState();
  });

  iconDialogTitleInput?.addEventListener('blur', () => {
    if (!iconDialogTitleInput.value.trim()) {
      state.iconDialog.status = 'Name is required.';
      state.iconDialog.statusKind = 'error';
      renderApp(rootElement, state);
    }
  });

  iconDialogUrlInput?.addEventListener('input', () => {
    state.iconDialog.draftUrl = iconDialogUrlInput.value;
    updateSaveButtonState();
  });

  iconDialogUrlInput?.addEventListener('blur', () => {
    const val = iconDialogUrlInput.value.trim();
    if (val && !isValidBookmarkUrl(val)) {
      state.iconDialog.status = 'Enter a valid URL (for example https://example.com).';
      state.iconDialog.statusKind = 'error';
      renderApp(rootElement, state);
    }
  });

  const saveDialogBookmark = async () => {
    const target = state.iconDialog.target;
    if (!target) {
      return;
    }

    const nextTitle = state.iconDialog.draftTitle.trim();
    const nextUrl = state.iconDialog.draftUrl.trim();
    if (!nextTitle) {
      state.iconDialog.status = 'Name is required.';
      state.iconDialog.statusKind = 'error';
      renderApp(rootElement, state);
      return;
    }

    if (!nextUrl) {
      state.iconDialog.status = 'URL is required.';
      state.iconDialog.statusKind = 'error';
      renderApp(rootElement, state);
      return;
    }

    if (!isValidBookmarkUrl(nextUrl)) {
      state.iconDialog.status = 'Enter a valid URL (for example https://example.com).';
      state.iconDialog.statusKind = 'error';
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
      changes: {
        title: nextTitle,
        url: nextUrl,
      },
    });

    await refreshBookmarkTree(state);

    const updatedTarget = state.iconDialog.target;
    if (updatedTarget) {
      state.iconDialog.draftTitle = updatedTarget.title || nextTitle;
      state.iconDialog.draftUrl = updatedTarget.url;
      state.iconDialog.status = `Saved bookmark ${updatedTarget.title || getHostname(updatedTarget.url)}.`;
      state.iconDialog.statusKind = 'success';
      state.iconDialog.query = `${updatedTarget.title || getSearchName(updatedTarget.url)} logo`;
      await loadIconDialogPreview(state, updatedTarget);
    }

    renderApp(rootElement, state);
  };

  iconDialogSaveButton?.addEventListener('click', async () => {
    await saveDialogBookmark();
  });

  iconDialogTitleInput?.addEventListener('keydown', async event => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    await saveDialogBookmark();
  });

  iconDialogUrlInput?.addEventListener('keydown', async event => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    await saveDialogBookmark();
  });

  iconDialogSearchInput?.addEventListener('keydown', async event => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    await searchIconDialog(rootElement, state, state.iconDialog.query);
  });

  iconDialogSearchButton?.addEventListener('click', async () => {
    await searchIconDialog(rootElement, state, state.iconDialog.query);
  });

  iconDialogUploadButton?.addEventListener('click', () => {
    iconDialogFileInput?.click();
  });

  iconDialogFileInput?.addEventListener('change', async () => {
    const file = iconDialogFileInput.files?.[0];
    const target = state.iconDialog.target;
    if (!file || !target) {
      return;
    }

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
      bookmarkUrl: target.url,
      bookmarkTitle: target.title,
      dataUrl: normalizedDataUrl,
      fileName: file.name,
      mimeType: 'image/png',
    });

    state.iconDialog.status = `Custom icon saved for ${target.title || getHostname(target.url)}.`;
    state.iconDialog.statusKind = 'success';
    state.iconDialog.previewIcon = {
      cacheKey: `override:${target.url}`,
      sourceKind: 'override',
      dataUrl: normalizedDataUrl,
      lastUpdated: Date.now(),
      isFallback: false,
    };
    state.resolvedIcons[target.url] = state.iconDialog.previewIcon;
    iconDialogFileInput.value = '';
    renderApp(rootElement, state);
  });

  iconDialogRefreshButton?.addEventListener('click', async () => {
    const target = state.iconDialog.target;
    if (!target) {
      return;
    }

    await sendRuntimeMessage<{
      type: typeof messageTypes.invalidateIcon;
      bookmarkUrl: string;
    }, InvalidateIconResponse>({
      type: messageTypes.invalidateIcon,
      bookmarkUrl: target.url,
    });

    state.iconDialog.status = `Refreshed icon cache for ${target.title || getHostname(target.url)}.`;
    state.iconDialog.statusKind = 'info';
    await loadIconDialogPreview(state, target, rootElement);
    renderApp(rootElement, state);
  });

  iconDialogRemoveButton?.addEventListener('click', async () => {
    const target = state.iconDialog.target;
    if (!target) {
      return;
    }

    await sendRuntimeMessage<{
      type: typeof messageTypes.removeIconOverride;
      bookmarkUrl: string;
      bookmarkTitle?: string;
    }, RemoveIconOverrideResponse>({
      type: messageTypes.removeIconOverride,
      bookmarkUrl: target.url,
      bookmarkTitle: target.title,
    });

    state.iconDialog.status = `Removed custom icon for ${target.title || getHostname(target.url)}.`;
    state.iconDialog.statusKind = 'info';
    await loadIconDialogPreview(state, target, rootElement);
    renderApp(rootElement, state);
  });

  iconDialogResultButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const target = state.iconDialog.target;
      const imageUrl = button.dataset.iconCandidateUrl;
      if (!target || !imageUrl) {
        return;
      }

      const response = await sendRuntimeMessage<{
        type: typeof messageTypes.setIconOverrideFromUrl;
        bookmarkUrl: string;
        bookmarkTitle?: string;
        imageUrl: string;
        fileName?: string;
      }, SetIconOverrideFromUrlResponse>({
        type: messageTypes.setIconOverrideFromUrl,
        bookmarkUrl: target.url,
        bookmarkTitle: target.title,
        imageUrl,
      });

      state.iconDialog.status = `Applied searched icon for ${target.title || getHostname(target.url)}.`;
      state.iconDialog.statusKind = 'success';
      state.iconDialog.previewIcon = response.icon;
      state.resolvedIcons[target.url] = response.icon;
      renderApp(rootElement, state);
    });
  });

  sectionButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const section = button.dataset.section as SettingsSectionId;
      if (section === 'general') {
        state.generalSubpage = 'general';
      }
      await switchSettingsSection(rootElement, state, section);
    });
  });

  setupGridInteractions(rootElement, state, bookmarkCanvas, bookmarkGrid, currentFolder);
  setupDockInteractions(rootElement, state, bookmarkDock, dockStrip, dockFolder);

  const currentGeneration = ++iconRenderGeneration;
  void hydrateBookmarkIcons(rootElement, state, currentGeneration);
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
  if (state.iconDialog.open) {
    state.iconDialog = createClosedIconDialogState();
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

  if (state.iconDialog.open || isEditableTarget(event.target)) {
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

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], .icon-dialog, .settings-drawer'));
}

function clearSelection(state: AppState): void {
  state.selectedIds = [];
  state.selectionAnchorId = null;
  state.selectionScope = null;
}

function normalizeSelection(state: AppState): void {
  if (!state.selectionScope) {
    clearSelection(state);
    return;
  }

  const visibleIds = new Set(getFolderChildren(state, state.selectionScope.folderId).map(node => node.id));
  state.selectedIds = state.selectedIds.filter(id => visibleIds.has(id));
  if (state.selectionAnchorId && !visibleIds.has(state.selectionAnchorId)) {
    state.selectionAnchorId = state.selectedIds[0] ?? null;
  }

  if (!state.selectedIds.length) {
    state.selectionScope = null;
  }

  if (state.contextMenu?.kind === 'selection' && state.selectedIds.length < 2) {
    state.contextMenu = null;
  }
}

function getFolderChildren(state: AppState, folderId: string): BookmarkNode[] {
  return getFolderNode(state.tree, folderId)?.children ?? [];
}

function getCurrentFolderChildren(state: AppState): BookmarkNode[] {
  return (getFolderNode(state.tree, state.currentFolderId) ?? getDefaultFolder(state.tree, state.settings.rootFolderId))?.children ?? [];
}

function isItemSelected(state: AppState, itemId: string, surface: SelectionSurface, folderId: string): boolean {
  const selectionScope = state.selectionScope;
  return selectionScope !== null
    && selectionScope.surface === surface
    && selectionScope.folderId === folderId
    && state.selectedIds.includes(itemId);
}

function setSelection(state: AppState, ids: string[], scope: SelectionScope | null, anchorId: string | null = ids[0] ?? null): void {
  state.selectedIds = ids;
  state.selectionAnchorId = anchorId;
  state.selectionScope = ids.length && scope ? scope : null;
}

function getOrderedSelectedIds(state: AppState, scope: SelectionScope | null = state.selectionScope): string[] {
  if (!scope) {
    return [];
  }

  const selectedSet = new Set(state.selectedIds);
  return getFolderChildren(state, scope.folderId)
    .filter(node => selectedSet.has(node.id))
    .map(node => node.id);
}

function getSelectedNodes(state: AppState, ids: string[] = getOrderedSelectedIds(state), scope: SelectionScope | null = state.selectionScope): BookmarkNode[] {
  if (!scope) {
    return [];
  }

  const idSet = new Set(ids);
  return getFolderChildren(state, scope.folderId).filter(node => idSet.has(node.id));
}

function createSelectionContextMenuState(state: AppState, x: number, y: number, scope: SelectionScope | null = state.selectionScope): SelectionContextMenuState {
  const selectedNodes = getSelectedNodes(state, getOrderedSelectedIds(state, scope), scope);
  return {
    kind: 'selection',
    x,
    y,
    target: {
      ids: selectedNodes.map(node => node.id),
      bookmarkCount: selectedNodes.filter(node => Boolean(node.url)).length,
      folderCount: selectedNodes.filter(node => !node.url).length,
      scope,
    },
  };
}

function openSelectionInNewTabs(state: AppState, ids: string[], scope: SelectionScope | null = state.selectionScope): void {
  for (const node of getSelectedNodes(state, ids, scope)) {
    if (node.url) {
      window.open(node.url, '_blank', 'noopener');
      continue;
    }

    openFolderView(node.id, true);
  }
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
  await refreshBookmarkTree(state);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);
}

function setupGridInteractions(rootElement: HTMLDivElement, state: AppState, bookmarkCanvas: HTMLElement | null, bookmarkGrid: HTMLElement | null, currentFolder: BookmarkNode): void {
  setupSurfaceInteractions(rootElement, state, {
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

function setupDockInteractions(rootElement: HTMLDivElement, state: AppState, bookmarkDock: HTMLElement | null, dockStrip: HTMLElement | null, dockFolder: BookmarkNode | null): void {
  if (!dockFolder) {
    return;
  }

  setupSurfaceInteractions(rootElement, state, {
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

function setupSurfaceInteractions(
  rootElement: HTMLDivElement,
  state: AppState,
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

  const visibleItems = getFolderChildren(state, folderId);
  const buttonById = new Map(itemButtons.map(button => [button.dataset[idDatasetKey] || '', button]));

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
    });
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
    interaction.dragIds.forEach(id => {
      buttonById.get(id)?.setAttribute('data-drag-source', 'true');
    });

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
    if (!interaction) {
      return;
    }

    const completedInteraction = interaction;
    interaction = null;

    if (completedInteraction.kind === 'dragging') {
      clearDropIndicator();
      if (completedInteraction.dropTarget?.kind === 'folder') {
        const moved = await moveSelectionIntoFolder(rootElement, state, completedInteraction.dragIds, completedInteraction.dropTarget.folderId, scope);
        if (!moved) {
          renderApp(rootElement, state);
        }
        return;
      }

      if (completedInteraction.dropTarget?.kind === 'reorder') {
        const reordered = await reorderSelection(rootElement, state, completedInteraction.dragIds, completedInteraction.dropTarget.index, scope);
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

    button.addEventListener('click', async event => {
      if (button.dataset.suppressClick === 'true') {
        button.dataset.suppressClick = 'false';
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      if (event.metaKey || event.ctrlKey) {
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

      if (item.url) {
        openBookmark(item.url, state.settings.openLinksInNewTab);
        return;
      }

      navigateToFolder(state, item.id);
      await preloadVisibleIcons(state);
      renderApp(rootElement, state);
    });
  });

  surfaceElement.addEventListener('pointerdown', event => {
    if (event.button !== 0) {
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

function isSameScope(left: SelectionScope | null, right: SelectionScope | null): boolean {
  return Boolean(left && right && left.surface === right.surface && left.folderId === right.folderId);
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

async function reorderSelection(rootElement: HTMLDivElement, state: AppState, dragIds: string[], dropIndex: number, scope: SelectionScope): Promise<boolean> {
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
  await refreshBookmarkTree(state);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);
  return true;
}

async function moveSelectionIntoFolder(rootElement: HTMLDivElement, state: AppState, dragIds: string[], targetFolderId: string, scope: SelectionScope): Promise<boolean> {
  if (!canMoveItemsIntoFolder(state, dragIds, targetFolderId, scope)) {
    return false;
  }

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
  await refreshBookmarkTree(state);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);
  return true;
}

async function preloadVisibleIcons(state: AppState): Promise<void> {
  const visibleBookmarks = collectVisibleBookmarks(state);
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

function collectVisibleBookmarks(state: AppState): BookmarkActionTarget[] {
  const directTargets = collectVisibleBookmarkTargets(state.tree, state.currentFolderId, state.settings);
  const previewTargets = collectDockPreviewBookmarkTargets(state.tree, state.settings);
  const uniqueTargets = new Map<string, BookmarkActionTarget>();

  for (const target of [...directTargets, ...previewTargets]) {
    if (!target.url || uniqueTargets.has(target.url)) {
      continue;
    }

    uniqueTargets.set(target.url, target);
  }

  return Array.from(uniqueTargets.values());
}

function collectDockPreviewBookmarkTargets(tree: BookmarkNode[], settings: AppSettings): BookmarkActionTarget[] {
  const dockFolder = getDockFolder(tree, settings);
  if (!dockFolder) {
    return [];
  }

  const targets: BookmarkActionTarget[] = [];
  for (const item of dockFolder.children ?? []) {
    if (item.url) {
      continue;
    }

    for (const child of getDockPreviewItems(item)) {
      if (!child.url) {
        continue;
      }

      targets.push({
        id: child.id,
        url: child.url,
        title: child.title || getHostname(child.url),
        parentId: child.parentId ?? '',
      });
    }
  }

  return targets;
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

function renderBookmarkTile(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, index: number, selected: boolean): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'tile');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';
    return `
      <button class="bookmark-tile link-tile" data-link-url="${escapeAttribute(node.url)}" data-bookmark-id="${node.id}" data-bookmark-title="${escapeAttribute(label)}" data-parent-id="${escapeAttribute(node.parentId ?? '')}" data-grid-item-id="${node.id}" data-grid-item-index="${String(index)}" data-grid-item-kind="bookmark" data-selected="${String(selected)}" type="button">
        <div class="tile-icon tile-icon--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</div>
        <span class="tile-label">${escapeHtml(label)}</span>
      </button>
    `;
  }

  return renderFolderCard(node, resolvedIcons, 'tile', index, selected);
}

function renderDockItem(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, index: number, selected: boolean): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const meta = getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'dock');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';
    return `
      <button class="dock-item dock-item--link-card" data-link-url="${escapeAttribute(node.url)}" data-bookmark-id="${node.id}" data-bookmark-title="${escapeAttribute(label)}" data-parent-id="${escapeAttribute(node.parentId ?? '')}" data-dock-item-id="${node.id}" data-dock-item-index="${String(index)}" data-dock-item-kind="bookmark" data-selected="${String(selected)}" type="button">
        <span class="dock-item__preview dock-item__preview--link">
          <span class="dock-item__icon dock-item__icon--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</span>
        </span>
        <span class="dock-item__label">${escapeHtml(label)}</span>
        <span class="dock-item__meta">${escapeHtml(meta)}</span>
      </button>
    `;
  }

  return renderFolderCard(node, resolvedIcons, 'dock', index, selected);
}

function renderFolderCard(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>, variant: 'tile' | 'dock', index?: number, selected = false): string {
  const itemCount = node.children?.length ?? 0;
  const previewItems = getFolderPreviewItems(node, variant);
  const classes = variant === 'tile'
    ? 'bookmark-tile folder-card folder-card--tile'
    : 'dock-item folder-card folder-card--dock';
  const metaMarkup = variant === 'dock'
    ? `<span class="folder-card__meta">${itemCount === 1 ? '1 item' : `${String(itemCount)} items`}</span>`
    : '';

  return `
    <button class="${classes}" data-folder-id="${node.id}" data-folder-title="${escapeAttribute(node.title || 'Untitled')}" data-parent-id="${escapeAttribute(node.parentId ?? '')}" ${variant === 'tile' ? `data-grid-item-id="${node.id}" data-grid-item-index="${String(index ?? 0)}" data-grid-item-kind="folder" data-selected="${String(selected)}"` : `data-dock-item-id="${node.id}" data-dock-item-index="${String(index ?? 0)}" data-dock-item-kind="folder" data-selected="${String(selected)}"`} type="button">
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

function renderStatusMessage(statusMessage: AppStatus): string {
  return `
    <div class="app-status" data-kind="${statusMessage.kind}" role="status" aria-live="polite">
      <span>${escapeHtml(statusMessage.message)}</span>
      <button class="app-status__dismiss icon-button" type="button" aria-label="Dismiss message">${renderUiIcon('close')}</button>
    </div>
  `;
}

function renderContextMenu(state: AppState, contextMenu: ContextMenuState): string {
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
    const canPaste = Boolean(contextMenu.target.parentId) && canPasteClipboardIntoFolder(state, contextMenu.target.parentId);
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
    const canPaste = canPasteClipboardIntoFolder(state, contextMenu.target.id);
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

  const canPaste = canPasteClipboardIntoFolder(state, contextMenu.target.id);
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

function renderIconDialog(iconDialog: IconDialogState): string {
  const title = iconDialog.target?.title || 'Bookmark';
  const draftTitle = iconDialog.draftTitle.trim();
  const draftUrl = iconDialog.draftUrl.trim();
  const canSaveBookmark = draftTitle.length > 0 && isValidBookmarkUrl(draftUrl);
  const previewMarkup = iconDialog.previewIcon && iconDialog.previewIcon.sourceKind !== 'generated'
    ? `<img class="icon-dialog__preview-image" src="${escapeAttribute(iconDialog.previewIcon.dataUrl)}" alt="" />`
    : (iconDialog.target
      ? `<img class="icon-dialog__preview-image" src="${escapeAttribute(getFaviconImageUrl(iconDialog.target.url, 'dialog'))}" alt="" referrerpolicy="no-referrer" />`
      : renderIconPlaceholder(title));

  return `
    <div class="icon-dialog-layer">
      <button class="icon-dialog-scrim" type="button" aria-label="Close icon picker"></button>
      <section class="icon-dialog" role="dialog" aria-modal="true" aria-label="Edit bookmark">
        <header class="icon-dialog__header">
          <div class="icon-dialog__header-copy">
            <p class="eyebrow">Edit bookmark</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <button class="icon-dialog-close icon-button" type="button" aria-label="Close icon picker">${renderUiIcon('close')}</button>
        </header>
        <div class="icon-dialog__body">
          <aside class="icon-dialog__preview-panel">
            <div class="icon-dialog__edit-fields">
              <label class="field icon-dialog__field">
                <span>Name</span>
                <input name="iconDialogTitle" type="text" value="${escapeAttribute(iconDialog.draftTitle)}" placeholder="Bookmark name" required />
              </label>
              <label class="field icon-dialog__field">
                <span>URL</span>
                <input name="iconDialogUrl" type="url" value="${escapeAttribute(iconDialog.draftUrl)}" placeholder="https://example.com" required />
              </label>
              <button class="save-button button-with-icon icon-dialog-save-button" type="button" ${canSaveBookmark ? '' : 'disabled'}>${renderUiIcon('save')}<span>Save bookmark</span></button>
            </div>
            <div class="icon-dialog__preview">
              ${previewMarkup}
              <div class="icon-dialog__preview-actions">
                <button class="icon-dialog__preview-action icon-dialog__preview-action--refresh icon-dialog-refresh-button" type="button" aria-label="Refresh icon" title="Refresh icon">${renderUiIcon('refresh')}</button>
                <button class="icon-dialog__preview-action icon-dialog__preview-action--remove icon-dialog-remove-button" type="button" aria-label="Remove custom icon" title="Remove custom icon">${renderUiIcon('trash')}</button>
                <button class="icon-dialog__preview-action icon-dialog__preview-action--upload icon-dialog-upload-button" type="button" aria-label="Upload icon" title="Upload icon">${renderUiIcon('upload')}<span>Upload image</span></button>
              </div>
            </div>
            <p class="field-hint">Hover the preview for quick icon actions, or choose one of the search results.</p>
            <input class="icon-file-input" name="iconDialogFile" type="file" accept="image/*" />
            ${iconDialog.status ? `<div class="icon-dialog-toast" data-kind="${iconDialog.statusKind || 'info'}" role="status">${escapeHtml(iconDialog.status)}</div>` : ''}
          </aside>
          <div class="icon-dialog__search-panel">
            <div class="visual-section__header">
              <h3>Search</h3>
              <p class="field-hint">Search for an icon or favicon and click a result to apply it immediately.</p>
            </div>
            <div class="icon-dialog__search-row">
              <input name="iconDialogSearchQuery" type="search" value="${escapeAttribute(iconDialog.query)}" placeholder="Search for an icon" />
              <button class="save-button button-with-icon icon-dialog-search-button" type="button">${renderUiIcon('search')}<span>Search</span></button>
            </div>
            <div class="icon-dialog__results" data-loading="${String(iconDialog.loading)}">
              ${renderIconDialogResults(iconDialog)}
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderIconDialogResults(iconDialog: IconDialogState): string {
  if (iconDialog.loading) {
    return '<p class="field-hint">Searching icons...</p>';
  }

  if (!iconDialog.results.length) {
    return '<p class="field-hint">No icon candidates yet. Try a different search term.</p>';
  }

  return iconDialog.results.map(candidate => `
    <button class="icon-result-card" data-icon-candidate-url="${escapeAttribute(candidate.imageUrl)}" type="button" title="${escapeAttribute(candidate.label)}">
      <img class="icon-result-card__image" src="${escapeAttribute(candidate.previewUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="icon-result-card__label">${escapeHtml(candidate.label)}</span>
    </button>
  `).join('');
}

function navigateToFolder(state: AppState, folderId: string): void {
  if (!getFolderNode(state.tree, folderId)) {
    return;
  }
  state.currentFolderId = folderId;
  clearSelection(state);
  state.contextMenu = null;
  syncFolderHash(folderId);
  persistLastFolder(state.settings, folderId);
}

function createClosedIconDialogState(): IconDialogState {
  return {
    open: false,
    target: null,
    draftTitle: '',
    draftUrl: '',
    query: '',
    status: '',
    statusKind: '',
    loading: false,
    results: [],
    previewIcon: null,
  };
}

async function openIconDialog(rootElement: HTMLDivElement, state: AppState, target: BookmarkActionTarget): Promise<void> {
  state.iconDialog = {
    open: true,
    target,
    draftTitle: target.title || '',
    draftUrl: target.url,
    query: `${target.title || getSearchName(target.url)} logo`,
    status: '',
    statusKind: '',
    loading: true,
    results: [],
    previewIcon: null,
  };
  renderApp(rootElement, state);
  await Promise.allSettled([
    loadIconDialogPreview(state, target, rootElement),
    searchIconDialog(rootElement, state, state.iconDialog.query),
  ]);
}

async function loadIconDialogPreview(state: AppState, target: BookmarkActionTarget, rootElement?: HTMLDivElement): Promise<void> {
  const response = await sendRuntimeMessage<{
    type: typeof messageTypes.getIcon;
    bookmarkUrl: string;
    bookmarkTitle?: string;
  }, GetIconResponse>({
    type: messageTypes.getIcon,
    bookmarkUrl: target.url,
    bookmarkTitle: target.title,
  });

  if (!state.iconDialog.open || state.iconDialog.target?.url !== target.url) {
    return;
  }

  state.iconDialog.previewIcon = response.icon;
  state.resolvedIcons[target.url] = response.icon;
  if (rootElement) {
    renderApp(rootElement, state);
  }
}

async function searchIconDialog(rootElement: HTMLDivElement, state: AppState, query: string): Promise<void> {
  const target = state.iconDialog.target;
  if (!target) {
    return;
  }

  state.iconDialog.loading = true;
  state.iconDialog.status = `Searching icons for ${target.title || getHostname(target.url)}...`;
  state.iconDialog.statusKind = 'info';
  renderApp(rootElement, state);

  try {
    const response = await sendRuntimeMessage<{
      type: typeof messageTypes.searchIcons;
      query: string;
      bookmarkUrl?: string;
    }, SearchIconsResponse>({
      type: messageTypes.searchIcons,
      query,
      bookmarkUrl: target.url,
    });

    if (!state.iconDialog.open || state.iconDialog.target?.url !== target.url) {
      return;
    }

    state.iconDialog.query = query;
    state.iconDialog.loading = false;
    state.iconDialog.results = response.candidates;
    state.iconDialog.status = response.candidates.length
      ? `Found ${String(response.candidates.length)} icon candidates.`
      : 'No icon candidates found for that search.';
    state.iconDialog.statusKind = response.candidates.length ? 'info' : 'error';
    renderApp(rootElement, state);
  } catch {
    if (!state.iconDialog.open || state.iconDialog.target?.url !== target.url) {
      return;
    }

    state.iconDialog.loading = false;
    state.iconDialog.results = [];
    state.iconDialog.status = 'Icon search failed. Try a different search or use upload.';
    state.iconDialog.statusKind = 'error';
    renderApp(rootElement, state);
  }
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

  if (state.iconDialog.target?.id === target.id) {
    state.iconDialog = createClosedIconDialogState();
  }

  await refreshBookmarkTree(state);
  renderApp(rootElement, state);
}

async function refreshBookmarkTree(state: AppState): Promise<void> {
  const response = await sendRuntimeMessage<{ type: typeof messageTypes.getBookmarkTree }, GetBookmarkTreeResponse>({
    type: messageTypes.getBookmarkTree,
  });
  state.tree = response.tree;

  if (!getFolderNode(state.tree, state.currentFolderId)) {
    state.currentFolderId = resolveInitialFolderId(state.settings, state.tree, getLastFolder, getFolderIdFromHash);
  }

  if (state.iconDialog.target) {
    const nextTarget = findBookmarkActionTargetById(state.tree, state.iconDialog.target.id);
    if (nextTarget) {
      state.iconDialog.target = nextTarget;
    } else {
      state.iconDialog = createClosedIconDialogState();
    }
  }

  state.clipboard = refreshFolderClipboard(state.tree, state.clipboard);
  normalizeSelection(state);
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
      await openIconDialog(rootElement, state, target);
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

function getFolderActionTarget(element: HTMLElement): FolderActionTarget | null {
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

function refreshFolderClipboard(tree: BookmarkNode[], clipboard: BookmarkClipboardState | null): BookmarkClipboardState | null {
  if (!clipboard) {
    return null;
  }

  if (clipboard.mode === 'copy') {
    return clipboard;
  }

  const nextItems = clipboard.items
    .map(item => findNodeById(tree, item.id))
    .filter((node): node is BookmarkNode => Boolean(node))
    .map(node => cloneBookmarkNode(node));

  if (!nextItems.length) {
    return null;
  }

  return {
    mode: clipboard.mode,
    items: nextItems,
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
  await preloadVisibleIcons(state);

  const nextTarget = findBookmarkActionTargetById(state.tree, response.bookmark.id);
  if (nextTarget) {
    await openIconDialog(rootElement, state, nextTarget);
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

  await refreshBookmarkTree(state);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);
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

  await refreshBookmarkTree(state);
  renderApp(rootElement, state);
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

  await refreshBookmarkTree(state);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);
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

  await refreshBookmarkTree(state);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);
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

function cloneBookmarkNode(node: BookmarkNode): BookmarkNode {
  return {
    id: node.id,
    parentId: node.parentId,
    title: node.title,
    url: node.url,
    children: node.children?.map(child => cloneBookmarkNode(child)),
  };
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

function openFolderView(folderId: string, openInNewTab: boolean): void {
  const folderUrl = extensionApi.runtime.getURL(`newtab.html#folder=${encodeURIComponent(folderId)}`);
  if (openInNewTab) {
    window.open(folderUrl, '_blank', 'noopener');
    return;
  }

  window.open(folderUrl, '_blank', 'noopener,noreferrer,width=1280,height=900');
}

function getFolderIdFromHash(): string | null {
  const match = /^#folder=(.+)$/.exec(window.location.hash);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function syncFolderHash(folderId: string): void {
  const nextHash = `#folder=${encodeURIComponent(folderId)}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, '', nextHash);
  }
}

function getLastFolder(): string | null {
  try {
    return window.localStorage.getItem(lastFolderStorageKey);
  } catch {
    return null;
  }
}

function persistLastFolder(settings: AppSettings, folderId: string): void {
  try {
    if (settings.rememberLastFolder) {
      window.localStorage.setItem(lastFolderStorageKey, folderId);
    }
  } catch {
    // Ignore storage failures.
  }
}

function removeLastFolder(): void {
  try {
    window.localStorage.removeItem(lastFolderStorageKey);
  } catch {
    // Ignore storage failures.
  }
}

function openBookmark(url: string, openInNewTab: boolean): void {
  if (openInNewTab) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  window.location.assign(url);
}

function normalizeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#f4f0e8';
}

function isValidBookmarkUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Extracts the most meaningful label from a URL for use as a search term.
// e.g. https://www.twitch.tv → "twitch", https://apps.google.com → "google"
function getSearchName(url: string): string {
  try {
    const parts = new URL(url).hostname.replace(/^www\./, '').split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '');
  } catch {
    return '';
  }
}

function getInitial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed[0].toUpperCase() : '•';
}

async function hydrateBookmarkIcons(rootElement: HTMLDivElement, state: AppState, generation: number): Promise<void> {
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

async function normalizeUploadedImage(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const canvas = document.createElement('canvas');
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable for icon normalization.');
  }

  context.clearRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';

  const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = (size - drawWidth) / 2;
  const drawY = (size - drawHeight) / 2;

  context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
  if (!blob) {
    throw new Error('Failed to export the uploaded icon.');
  }

  return readFileAsDataUrl(blob);
}

async function normalizeBackgroundImage(file: File): Promise<string> {
  const sourceDataUrl = await readFileAsDataUrl(file);
  const image = await loadImageElement(sourceDataUrl);
  const maxDimension = 2200;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable for background normalization.');
  }

  context.clearRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) {
    throw new Error('Failed to export the uploaded background image.');
  }

  return readFileAsDataUrl(blob);
}

function readFileAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read icon data.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read icon data.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode the uploaded image.'));
    image.src = src;
  });
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
