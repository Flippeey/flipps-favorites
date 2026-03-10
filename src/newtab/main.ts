import './styles.css';
import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type AppSettings, type BookmarkNode, type GetBookmarkTreeResponse, type GetIconResponse, type GetSettingsResponse, type IconSearchCandidate, type InvalidateIconResponse, type PatchSettingsResponse, type PingResponse, type RemoveBookmarkResponse, type RemoveIconOverrideResponse, type ResolvedIcon, type SearchIconsResponse, type SettingsSectionId, type SetIconOverrideFromUrlResponse, type SetIconOverrideResponse, type ThemeMode, type UpdateBookmarkResponse } from '../shared/messages';

const root = document.querySelector<HTMLDivElement>('#app');
const lastFolderStorageKey = 'newtab/last-folder';
const defaultAccentColor = '#3F72DC';
const tileFaviconCssSize = 64;
const dockFaviconCssSize = 32;
const dialogFaviconCssSize = 96;
const maxFaviconRequestSize = 256;
const accentPresets = [
  { id: 'orange', label: 'Orange', value: '#D8783F' },
  { id: 'gold', label: 'Gold', value: '#C9A227' },
  { id: 'red', label: 'Red', value: '#C75252' },
  { id: 'teal', label: 'Teal', value: '#23867B' },
  { id: 'blue', label: 'Blue', value: '#3F72DC' },
  { id: 'grey', label: 'Grey', value: '#778292' },
  { id: 'anthracite', label: 'Anthracite', value: '#4B5360' },
  { id: 'purple', label: 'Purple', value: '#7D60D8' },
] as const;
const themeModeOptions: Array<{ id: Exclude<ThemeMode, 'system'>; label: string; description: string; preview: 'light' | 'dark' }> = [
  { id: 'light', label: 'Light', description: 'Bright workspace', preview: 'light' },
  { id: 'dark', label: 'Dark', description: 'Low-glare workspace', preview: 'dark' },
];

interface AppState {
  settings: AppSettings;
  tree: BookmarkNode[];
  currentFolderId: string;
  drawerOpen: boolean;
  iconToolTargetUrl: string;
  iconToolStatus: string;
  contextMenu: BookmarkContextMenuState | null;
  iconDialog: IconDialogState;
  resolvedIcons: Record<string, ResolvedIcon>;
}

interface BookmarkActionTarget {
  id: string;
  url: string;
  title: string;
}

interface BookmarkContextMenuState {
  x: number;
  y: number;
  target: BookmarkActionTarget;
}

interface IconDialogState {
  open: boolean;
  target: BookmarkActionTarget | null;
  query: string;
  remoteUrl: string;
  status: string;
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
    currentFolderId: resolveInitialFolderId(settingsResponse.settings, bookmarkResponse.tree),
    drawerOpen: false,
    iconToolTargetUrl: resolveInitialIconToolTarget(bookmarkResponse.tree),
    iconToolStatus: '',
    contextMenu: null,
    iconDialog: createClosedIconDialogState(),
    resolvedIcons: {},
  };

  syncFolderHash(state.currentFolderId);
  persistLastFolder(state.settings, state.currentFolderId);
  await preloadVisibleIcons(state);
  renderApp(rootElement, state);

  window.addEventListener('hashchange', async () => {
    const folderId = getFolderIdFromHash();
    if (!folderId || folderId === state.currentFolderId || !getFolderNode(state.tree, folderId)) {
      return;
    }
    state.currentFolderId = folderId;
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
  const allLinkOptions = collectLinkOptions(state.tree);
  const libraryFolders = getLibraryFolders(state.tree);
  const breadcrumbs = getBreadcrumbs(state.tree, currentFolder.id);
  const canvasItems = currentFolder.children ?? [];
  const dockFolder = getDockFolder(state.tree, state.settings);
  const dockItems = dockFolder?.children ?? [];
  const activeSection = state.settings.settingsSection;
  const themeMode = normalizeThemeMode(state.settings.themeMode);
  const accentColor = normalizeHexColor(state.settings.accentColor, defaultAccentColor);
  const activeIconToolTargetUrl = resolveIconToolTarget(state.iconToolTargetUrl, allLinkOptions);

  if (state.iconToolTargetUrl !== activeIconToolTargetUrl) {
    state.iconToolTargetUrl = activeIconToolTargetUrl;
  }

  rootElement.innerHTML = `
    <div class="shell" data-theme-mode="${themeMode}" style="${buildThemeStyle(accentColor)}">
      <nav class="bookmarks-navbar" aria-label="Folder path">
        <div class="nav-side nav-side--left">
          <button class="nav-icon library-home" type="button">Home</button>
        </div>
        <div class="nav-scroll">
          ${renderNavTrail(libraryFolders, breadcrumbs)}
        </div>
        <div class="nav-side nav-side--right">
          <button class="drawer-toggle" type="button">Settings</button>
        </div>
      </nav>
      <main class="workspace">
        <section class="bookmark-canvas" aria-label="Bookmarks grid">
          <div class="bookmark-grid">
            ${canvasItems.map(item => renderBookmarkTile(item, state.resolvedIcons)).join('') || '<p class="empty-state">This folder is empty.</p>'}
          </div>
        </section>
        ${state.settings.showDock ? `
          <aside class="bookmark-dock" aria-label="Dock">
            <div class="dock-header">
              <span>${escapeHtml(dockFolder?.title || 'Dock')}</span>
              <button class="dock-settings-link" type="button">Customize</button>
            </div>
            <div class="dock-strip">
              ${dockItems.map(item => renderDockItem(item, state.resolvedIcons)).join('') || '<p class="dock-empty">Choose a dock folder in settings.</p>'}
            </div>
          </aside>
        ` : ''}
      </main>
      <aside class="settings-drawer" data-open="${String(state.drawerOpen)}">
        <div class="drawer-header">
          <div>
            <p class="eyebrow">Settings</p>
            <h2>Workspace controls</h2>
          </div>
          <button class="drawer-close" type="button" aria-label="Close settings">Close</button>
        </div>
        <div class="drawer-body">
          <nav class="drawer-nav">
            ${renderSectionButton('general', activeSection, 'Favorites')}
            ${renderSectionButton('appearance', activeSection, 'Theme')}
            ${renderSectionButton('advanced', activeSection, 'Advanced')}
          </nav>
          <section class="drawer-section">
            ${renderDrawerSection(activeSection, state.settings, allFolderOptions, allLinkOptions, state.iconToolTargetUrl, state.iconToolStatus)}
            <div class="drawer-actions">
              <button class="save-button" type="button">Save</button>
            </div>
          </section>
        </div>
      </aside>
      ${state.contextMenu ? renderBookmarkContextMenu(state.contextMenu) : ''}
      ${state.iconDialog.open ? renderIconDialog(state.iconDialog) : ''}
    </div>
  `;

  const drawer = rootElement.querySelector<HTMLElement>('.settings-drawer');
  const homeButton = rootElement.querySelector<HTMLButtonElement>('.library-home');
  const dockSettingsButton = rootElement.querySelector<HTMLButtonElement>('.dock-settings-link');
  const toggleButton = rootElement.querySelector<HTMLButtonElement>('.drawer-toggle');
  const closeButton = rootElement.querySelector<HTMLButtonElement>('.drawer-close');
  const saveButton = rootElement.querySelector<HTMLButtonElement>('.save-button');
  const sectionButtons = rootElement.querySelectorAll<HTMLButtonElement>('.section-button');
  const shell = rootElement.querySelector<HTMLElement>('.shell');
  const themeModeInput = rootElement.querySelector<HTMLInputElement>('input[name="themeMode"]');
  const useSystemThemeInput = rootElement.querySelector<HTMLInputElement>('input[name="useSystemTheme"]');
  const accentColorInput = rootElement.querySelector<HTMLInputElement>('input[name="accentColor"]');
  const accentHexInput = rootElement.querySelector<HTMLInputElement>('input[name="accentHex"]');
  const accentPickerInput = rootElement.querySelector<HTMLInputElement>('input[name="accentColorPicker"]');
  const accentPickerTrigger = rootElement.querySelector<HTMLButtonElement>('.accent-picker-trigger');
  const rootFolderInput = rootElement.querySelector<HTMLSelectElement>('select[name="rootFolderId"]');
  const dockFolderInput = rootElement.querySelector<HTMLSelectElement>('select[name="dockFolderId"]');
  const rememberLastFolderInput = rootElement.querySelector<HTMLInputElement>('input[name="rememberLastFolder"]');
  const openLinksInNewTabInput = rootElement.querySelector<HTMLInputElement>('input[name="openLinksInNewTab"]');
  const showDockInput = rootElement.querySelector<HTMLInputElement>('input[name="showDock"]');
  const iconToolTargetInput = rootElement.querySelector<HTMLSelectElement>('select[name="iconToolTargetUrl"]');
  const iconFileInput = rootElement.querySelector<HTMLInputElement>('input[name="iconFile"]');
  const iconUploadTrigger = rootElement.querySelector<HTMLButtonElement>('.icon-upload-trigger');
  const iconRemoveButton = rootElement.querySelector<HTMLButtonElement>('.icon-remove-button');
  const iconRefreshButton = rootElement.querySelector<HTMLButtonElement>('.icon-refresh-button');
  const contextMenuDismiss = rootElement.querySelector<HTMLButtonElement>('.context-menu-scrim');
  const contextMenuItems = rootElement.querySelectorAll<HTMLButtonElement>('[data-context-action]');
  const iconDialogDismiss = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-scrim');
  const iconDialogClose = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-close');
  const iconDialogSearchInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogSearchQuery"]');
  const iconDialogSearchButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-search-button');
  const iconDialogUploadButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-upload-button');
  const iconDialogFileInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogFile"]');
  const iconDialogRemoteUrlInput = rootElement.querySelector<HTMLInputElement>('input[name="iconDialogRemoteUrl"]');
  const iconDialogApplyUrlButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-apply-url-button');
  const iconDialogRefreshButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-refresh-button');
  const iconDialogRemoveButton = rootElement.querySelector<HTMLButtonElement>('.icon-dialog-remove-button');
  const iconDialogResultButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-icon-candidate-url]');
  const themeModeButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-theme-mode-option]');
  const accentButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-accent-option]');
  const folderButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-folder-id]');
  const linkButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-link-url]');

  const setDrawerOpen = (isOpen: boolean) => {
    state.drawerOpen = isOpen;
    drawer?.setAttribute('data-open', String(isOpen));
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
    await switchSettingsSection(rootElement, state, 'general');
  });

  toggleButton?.addEventListener('click', () => setDrawerOpen(true));
  closeButton?.addEventListener('click', () => setDrawerOpen(false));

  const syncThemePreview = () => {
    const nextThemeMode = getThemeModeFromInputs(themeModeInput?.value, useSystemThemeInput?.checked ?? false);
    const nextAccent = normalizeHexColor(accentHexInput?.value || accentColorInput?.value, defaultAccentColor);
    const effectiveThemeMode = resolveAppliedThemeMode(nextThemeMode);

    if (themeModeInput) {
      themeModeInput.value = nextThemeMode === 'system' ? effectiveThemeMode : nextThemeMode;
    }
    if (useSystemThemeInput) {
      useSystemThemeInput.checked = nextThemeMode === 'system';
    }
    if (accentColorInput) {
      accentColorInput.value = nextAccent;
    }
    if (accentHexInput && accentHexInput.value.toUpperCase() !== nextAccent) {
      accentHexInput.value = nextAccent;
    }
    if (accentPickerInput && accentPickerInput.value.toUpperCase() !== nextAccent) {
      accentPickerInput.value = nextAccent;
    }

    themeModeButtons.forEach(button => {
      button.dataset.active = String(button.dataset.themeModeOption === effectiveThemeMode);
    });

    const systemThemeCard = rootElement.querySelector<HTMLElement>('.system-theme-card');
    if (systemThemeCard) {
      systemThemeCard.dataset.active = String(nextThemeMode === 'system');
    }

    const presetMatch = accentPresets.find(preset => preset.value === nextAccent);
    accentButtons.forEach(button => {
      const buttonAccent = button.dataset.accentOption;
      const isActive = buttonAccent === nextAccent || (!presetMatch && buttonAccent === 'custom');
      button.dataset.active = String(isActive);
    });

    applyThemePreview(shell, nextThemeMode, nextAccent);
  };

  themeModeButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (useSystemThemeInput) {
        useSystemThemeInput.checked = false;
      }
      if (themeModeInput) {
        themeModeInput.value = normalizeThemeMode(button.dataset.themeModeOption);
      }
      syncThemePreview();
    });
  });

  useSystemThemeInput?.addEventListener('change', () => {
    syncThemePreview();
  });

  accentButtons.forEach(button => {
    button.addEventListener('click', () => {
      const accentOption = button.dataset.accentOption;
      if (!accentOption) {
        return;
      }

      if (accentOption === 'custom') {
        accentPickerInput?.click();
        syncThemePreview();
        return;
      }

      if (accentColorInput) {
        accentColorInput.value = accentOption;
      }
      if (accentHexInput) {
        accentHexInput.value = accentOption;
      }
      if (accentPickerInput) {
        accentPickerInput.value = accentOption;
      }
      syncThemePreview();
    });
  });

  accentHexInput?.addEventListener('input', () => {
    syncThemePreview();
  });

  accentPickerTrigger?.addEventListener('click', () => {
    accentPickerInput?.click();
  });

  accentPickerInput?.addEventListener('input', () => {
    if (accentHexInput) {
      accentHexInput.value = accentPickerInput.value.toUpperCase();
    }
    syncThemePreview();
  });

  syncThemePreview();

  folderButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const folderId = button.dataset.folderId;
      if (!folderId) {
        return;
      }
      navigateToFolder(state, folderId);
      await preloadVisibleIcons(state);
      renderApp(rootElement, state);
    });
  });

  linkButtons.forEach(button => {
    button.addEventListener('click', () => {
      const url = button.dataset.linkUrl;
      if (!url) {
        return;
      }
      openBookmark(url, state.settings.openLinksInNewTab);
    });

    button.addEventListener('contextmenu', event => {
      const target = getBookmarkActionTarget(button);
      if (!target) {
        return;
      }
      event.preventDefault();
      state.contextMenu = {
        x: event.clientX,
        y: event.clientY,
        target,
      };
      renderApp(rootElement, state);
    });
  });

  contextMenuDismiss?.addEventListener('click', () => {
    state.contextMenu = null;
    renderApp(rootElement, state);
  });

  contextMenuItems.forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.contextAction;
      const target = state.contextMenu?.target;
      if (!action || !target) {
        return;
      }

      state.contextMenu = null;

      switch (action) {
        case 'open-tab':
          openBookmark(target.url, true);
          return;
        case 'open-window':
          window.open(target.url, '_blank', 'noopener,noreferrer,width=1280,height=900');
          return;
        case 'edit':
          await editBookmarkFromContext(rootElement, state, target);
          return;
        case 'delete':
          await deleteBookmarkFromContext(rootElement, state, target);
          return;
        case 'icon':
          await openIconDialog(rootElement, state, target);
          return;
        default:
          renderApp(rootElement, state);
      }
    });
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

  iconDialogRemoteUrlInput?.addEventListener('input', () => {
    state.iconDialog.remoteUrl = iconDialogRemoteUrlInput.value;
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

  iconDialogApplyUrlButton?.addEventListener('click', async () => {
    const target = state.iconDialog.target;
    const imageUrl = state.iconDialog.remoteUrl.trim();
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

    state.iconDialog.status = `Applied remote icon for ${target.title || getHostname(target.url)}.`;
    state.iconDialog.previewIcon = response.icon;
    state.resolvedIcons[target.url] = response.icon;
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
      state.iconDialog.previewIcon = response.icon;
      state.resolvedIcons[target.url] = response.icon;
      renderApp(rootElement, state);
    });
  });

  sectionButtons.forEach(button => {
    button.addEventListener('click', async () => {
      await switchSettingsSection(rootElement, state, button.dataset.section as SettingsSectionId);
    });
  });

  saveButton?.addEventListener('click', async () => {
    const response = await sendRuntimeMessage<{ type: typeof messageTypes.patchSettings; patch: Partial<AppSettings> }, PatchSettingsResponse>({
      type: messageTypes.patchSettings,
      patch: {
        themeMode: normalizeThemeMode(themeModeInput?.value),
        accentColor: normalizeHexColor(accentHexInput?.value || accentColorInput?.value, state.settings.accentColor),
        rootFolderId: rootFolderInput?.value ?? state.settings.rootFolderId,
        dockFolderId: dockFolderInput?.value ?? state.settings.dockFolderId,
        rememberLastFolder: rememberLastFolderInput?.checked ?? state.settings.rememberLastFolder,
        openLinksInNewTab: openLinksInNewTabInput?.checked ?? state.settings.openLinksInNewTab,
        showDock: showDockInput?.checked ?? state.settings.showDock,
      },
    });

    state.settings = response.settings;
    if (!state.settings.rememberLastFolder) {
      removeLastFolder();
    }
    if (response.settings.rootFolderId && !isFolderDescendantOf(state.tree, state.currentFolderId, response.settings.rootFolderId)) {
      state.currentFolderId = response.settings.rootFolderId;
      syncFolderHash(state.currentFolderId);
      persistLastFolder(state.settings, state.currentFolderId);
    }
    state.drawerOpen = true;
    await preloadVisibleIcons(state);
    renderApp(rootElement, state);
  });

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
  const currentFolder = getFolderNode(state.tree, state.currentFolderId) ?? getDefaultFolder(state.tree, state.settings.rootFolderId);
  const dockFolder = getDockFolder(state.tree, state.settings);
  const candidates = [
    ...(currentFolder?.children ?? []),
    ...(dockFolder?.children ?? []),
  ];
  const uniqueBookmarks = new Map<string, BookmarkActionTarget>();

  for (const candidate of candidates) {
    if (!candidate.url || uniqueBookmarks.has(candidate.url)) {
      continue;
    }

    uniqueBookmarks.set(candidate.url, {
      id: candidate.id,
      url: candidate.url,
      title: candidate.title || getHostname(candidate.url),
    });
  }

  return Array.from(uniqueBookmarks.values());
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

function renderBookmarkTile(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'tile');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';
    return `
      <button class="bookmark-tile link-tile" data-link-url="${escapeAttribute(node.url)}" data-bookmark-id="${node.id}" data-bookmark-title="${escapeAttribute(label)}" type="button">
        <div class="tile-icon tile-icon--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</div>
        <span class="tile-label">${escapeHtml(label)}</span>
      </button>
    `;
  }

  const itemCount = node.children?.length ?? 0;
  return `
    <button class="bookmark-tile folder-tile" data-folder-id="${node.id}" type="button">
      <div class="tile-icon tile-icon--folder">${itemCount}</div>
      <span class="tile-label">${escapeHtml(node.title || 'Untitled')}</span>
    </button>
  `;
}

function renderDockItem(node: BookmarkNode, resolvedIcons: Record<string, ResolvedIcon>): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    const resolvedIcon = resolvedIcons[node.url];
    const visualIconMarkup = renderBookmarkVisualIcon(node.url, label, resolvedIcon, 'dock');
    const visualState = resolvedIcon && resolvedIcon.sourceKind !== 'generated'
      ? (resolvedIcon.isFallback ? 'fallback' : 'resolved')
      : 'favicon';
    return `
      <button class="dock-item" data-link-url="${escapeAttribute(node.url)}" data-bookmark-id="${node.id}" data-bookmark-title="${escapeAttribute(label)}" type="button">
        <span class="dock-item__icon dock-item__icon--link" data-bookmark-icon data-icon-url="${escapeAttribute(node.url)}" data-icon-title="${escapeAttribute(label)}" data-icon-placeholder="${escapeAttribute(getInitial(label))}" data-icon-state="${visualState}">${visualIconMarkup}</span>
        <span class="dock-item__label">${escapeHtml(label)}</span>
      </button>
    `;
  }

  return `
    <button class="dock-item" data-folder-id="${node.id}" type="button">
      <span class="dock-item__icon dock-item__icon--folder">${escapeHtml(getInitial(node.title || 'Folder'))}</span>
      <span class="dock-item__label">${escapeHtml(node.title || 'Untitled')}</span>
    </button>
  `;
}

function renderSectionButton(section: SettingsSectionId, currentSection: SettingsSectionId, label: string): string {
  return `<button class="section-button" data-section="${section}" data-active="${String(section === currentSection)}" type="button">${label}</button>`;
}

function renderDrawerSection(section: SettingsSectionId, settings: AppSettings, folderOptions: Array<{ id: string; label: string }>, iconOptions: Array<{ url: string; label: string }>, iconToolTargetUrl: string, iconToolStatus: string): string {
  if (section === 'general') {
    return `
      <h3>Favorites</h3>
      <label class="field">
        <span>Starting folder</span>
        <select name="rootFolderId">
          <option value="">Default library root</option>
          ${folderOptions.map(option => `<option value="${option.id}" ${option.id === settings.rootFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
      </label>
      <label class="toggle-field">
        <input name="rememberLastFolder" type="checkbox" ${settings.rememberLastFolder ? 'checked' : ''} />
        <span>Reopen the last visited folder when possible</span>
      </label>
      <label class="toggle-field">
        <input name="openLinksInNewTab" type="checkbox" ${settings.openLinksInNewTab ? 'checked' : ''} />
        <span>Open links in a new tab instead of replacing the new tab page</span>
      </label>
      <h3>Dock</h3>
      <label class="toggle-field">
        <input name="showDock" type="checkbox" ${settings.showDock ? 'checked' : ''} />
        <span>Show the bookmark dock at the bottom of the page</span>
      </label>
      <label class="field">
        <span>Dock folder</span>
        <select name="dockFolderId">
          <option value="">Mirror the main library root</option>
          ${folderOptions.map(option => `<option value="${option.id}" ${option.id === settings.dockFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
      </label>
    `;
  }

  if (section === 'appearance') {
    const accentColor = normalizeHexColor(settings.accentColor, defaultAccentColor);
    return `
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Theme</h3>
          <p class="field-hint">Choose light or dark directly, or let the page follow the browser preference automatically.</p>
        </div>
        <label class="system-theme-card" data-active="${String(settings.themeMode === 'system')}">
          <input name="useSystemTheme" type="checkbox" ${settings.themeMode === 'system' ? 'checked' : ''} />
          <span class="system-theme-card__copy">
            <strong>Use system preference</strong>
            <span>Default behavior. Light and dark cards below update to show which mode is currently active.</span>
          </span>
          <span class="system-theme-card__status">${resolveAppliedThemeMode(settings.themeMode) === 'dark' ? 'Dark active' : 'Light active'}</span>
        </label>
        <div class="theme-mode-grid" role="group" aria-label="Theme mode">
          ${themeModeOptions.map(option => renderThemeModeCard(option, settings.themeMode)).join('')}
        </div>
        <input name="themeMode" type="hidden" value="${resolveAppliedThemeMode(settings.themeMode)}" />
      </div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Accent</h3>
          <p class="field-hint">Choose from a palette that already works well, or open the custom picker.</p>
        </div>
        <div class="accent-gallery" role="group" aria-label="Accent presets">
          ${accentPresets.map(preset => renderAccentSwatch(preset, accentColor)).join('')}
          <button class="accent-swatch accent-swatch--custom" data-accent-option="custom" data-active="${String(!accentPresets.some(preset => preset.value === accentColor))}" type="button">
            <span class="accent-swatch__custom-preview"></span>
            <span class="accent-swatch__label">Custom</span>
          </button>
        </div>
        <input name="accentColor" type="hidden" value="${accentColor}" />
        <div class="accent-custom-panel">
          <button class="accent-picker-trigger" type="button">
            <span class="accent-picker-trigger__swatch" style="background:${accentColor}"></span>
            <span class="accent-picker-trigger__copy">
              <strong>Custom color</strong>
              <span>Open visual picker</span>
            </span>
          </button>
          <label class="accent-hex-field">
            <span>Hex</span>
            <input name="accentHex" type="text" value="${accentColor}" spellcheck="false" />
          </label>
          <input class="accent-picker-input" name="accentColorPicker" type="color" value="${accentColor}" aria-label="Choose accent color" />
        </div>
      </div>
    `;
  }

  return `
    <div class="drawer-note">
      <h3>Advanced</h3>
      <p>Popup mode, bookmarklets, drag and drop, import tools, and other optional features will live here once the main bookmarks experience is stable.</p>
    </div>
    <div class="visual-section">
      <div class="visual-section__header">
        <h3>Bookmark icons</h3>
        <p class="field-hint">Upload a local replacement icon, remove an override, or force a fresh favicon lookup for a specific bookmark.</p>
      </div>
      ${iconOptions.length ? `
        <label class="field">
          <span>Bookmark</span>
          <select name="iconToolTargetUrl">
            ${iconOptions.map(option => `<option value="${escapeAttribute(option.url)}" ${option.url === iconToolTargetUrl ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
        <input class="icon-file-input" name="iconFile" type="file" accept="image/*" />
        <div class="icon-tool-actions">
          <button class="drawer-secondary-button icon-upload-trigger" type="button">Upload icon</button>
          <button class="drawer-secondary-button icon-remove-button" type="button">Remove custom icon</button>
          <button class="drawer-secondary-button icon-refresh-button" type="button">Refresh icon</button>
        </div>
        <p class="icon-tool-status" data-empty="${String(!iconToolStatus)}">${escapeHtml(iconToolStatus || 'No icon action taken yet.')}</p>
      ` : `
        <p class="field-hint">No bookmark links are available yet. Add a bookmark to use the icon tools.</p>
      `}
    </div>
  `;
}

function renderBookmarkContextMenu(contextMenu: BookmarkContextMenuState): string {
  const x = clamp(contextMenu.x, 12, Math.max(12, window.innerWidth - 236));
  const y = clamp(contextMenu.y, 12, Math.max(12, window.innerHeight - 252));
  return `
    <div class="context-menu-layer">
      <button class="context-menu-scrim" type="button" aria-label="Close bookmark menu"></button>
      <div class="bookmark-context-menu" style="left:${x}px; top:${y}px" role="menu" aria-label="Bookmark actions">
        <button class="bookmark-context-menu__item" data-context-action="open-tab" type="button" role="menuitem">Open in new tab</button>
        <button class="bookmark-context-menu__item" data-context-action="open-window" type="button" role="menuitem">Open in new window</button>
        <div class="bookmark-context-menu__divider"></div>
        <button class="bookmark-context-menu__item" data-context-action="edit" type="button" role="menuitem">Edit...</button>
        <button class="bookmark-context-menu__item" data-context-action="delete" type="button" role="menuitem">Delete...</button>
        <button class="bookmark-context-menu__item" data-context-action="icon" type="button" role="menuitem">Icon...</button>
      </div>
    </div>
  `;
}

function renderIconDialog(iconDialog: IconDialogState): string {
  const title = iconDialog.target?.title || 'Bookmark';
  const previewMarkup = iconDialog.previewIcon && iconDialog.previewIcon.sourceKind !== 'generated'
    ? `<img class="icon-dialog__preview-image" src="${escapeAttribute(iconDialog.previewIcon.dataUrl)}" alt="" />`
    : (iconDialog.target
      ? `<img class="icon-dialog__preview-image" src="${escapeAttribute(getFaviconImageUrl(iconDialog.target.url, 'dialog'))}" alt="" referrerpolicy="no-referrer" />`
      : renderIconPlaceholder(title));

  return `
    <div class="icon-dialog-layer">
      <button class="icon-dialog-scrim" type="button" aria-label="Close icon picker"></button>
      <section class="icon-dialog" role="dialog" aria-modal="true" aria-label="Change bookmark icon">
        <header class="icon-dialog__header">
          <div class="icon-dialog__header-copy">
            <p class="eyebrow">Icon</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <button class="icon-dialog-close" type="button" aria-label="Close icon picker">Close</button>
        </header>
        <div class="icon-dialog__body">
          <aside class="icon-dialog__preview-panel">
            <div class="icon-dialog__preview">${previewMarkup}</div>
            <p class="field-hint">Upload a local image, paste a direct image URL, or choose one of the search results.</p>
            <input class="icon-file-input" name="iconDialogFile" type="file" accept="image/*" />
            <div class="icon-dialog__actions">
              <button class="drawer-secondary-button icon-dialog-upload-button" type="button">Upload image</button>
              <button class="drawer-secondary-button icon-dialog-remove-button" type="button">Remove custom icon</button>
              <button class="drawer-secondary-button icon-dialog-refresh-button" type="button">Refresh icon</button>
            </div>
            <label class="field">
              <span>Image URL</span>
              <input name="iconDialogRemoteUrl" type="url" value="${escapeAttribute(iconDialog.remoteUrl)}" placeholder="https://example.com/logo.png" />
            </label>
            <button class="save-button icon-dialog-apply-url-button" type="button">Use image URL</button>
            <p class="icon-tool-status" data-empty="${String(!iconDialog.status)}">${escapeHtml(iconDialog.status || 'No icon action taken yet.')}</p>
          </aside>
          <div class="icon-dialog__search-panel">
            <div class="visual-section__header">
              <h3>Search</h3>
              <p class="field-hint">Search for a logo or favicon and click a result to apply it immediately.</p>
            </div>
            <div class="icon-dialog__search-row">
              <input name="iconDialogSearchQuery" type="search" value="${escapeAttribute(iconDialog.query)}" placeholder="Search for a logo" />
              <button class="save-button icon-dialog-search-button" type="button">Search</button>
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
  syncFolderHash(folderId);
  persistLastFolder(state.settings, folderId);
}

function resolveInitialFolderId(settings: AppSettings, tree: BookmarkNode[]): string {
  const hashFolderId = getFolderIdFromHash();
  if (hashFolderId && getFolderNode(tree, hashFolderId)) {
    return hashFolderId;
  }

  const lastFolderId = settings.rememberLastFolder ? getLastFolder() : null;
  if (lastFolderId && getFolderNode(tree, lastFolderId)) {
    return lastFolderId;
  }

  return getDefaultFolder(tree, settings.rootFolderId)?.id ?? '';
}

function getDefaultFolder(tree: BookmarkNode[], preferredFolderId: string): BookmarkNode | null {
  if (preferredFolderId) {
    const preferred = getFolderNode(tree, preferredFolderId);
    if (preferred) {
      return preferred;
    }
  }

  return tree[0]?.children?.find(node => !node.url) ?? null;
}

function getDockFolder(tree: BookmarkNode[], settings: AppSettings): BookmarkNode | null {
  if (!settings.showDock) {
    return null;
  }
  if (settings.dockFolderId) {
    const dockFolder = getFolderNode(tree, settings.dockFolderId);
    if (dockFolder) {
      return dockFolder;
    }
  }
  return getDefaultFolder(tree, settings.rootFolderId);
}

function getFolderNode(tree: BookmarkNode[], folderId: string): BookmarkNode | null {
  const node = findNodeById(tree, folderId);
  return node && !node.url ? node : null;
}

function findNodeById(nodes: BookmarkNode[], targetId: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === targetId) {
      return node;
    }
    const found = findNodeById(node.children ?? [], targetId);
    if (found) {
      return found;
    }
  }
  return null;
}

function getBreadcrumbs(tree: BookmarkNode[], folderId: string): BookmarkNode[] {
  return findPath(tree, folderId).filter(node => node.id !== tree[0]?.id);
}

function findPath(nodes: BookmarkNode[], targetId: string, trail: BookmarkNode[] = []): BookmarkNode[] {
  for (const node of nodes) {
    const nextTrail = [...trail, node];
    if (node.id === targetId) {
      return nextTrail;
    }
    const result = findPath(node.children ?? [], targetId, nextTrail);
    if (result.length) {
      return result;
    }
  }
  return [];
}

function collectFolderOptions(tree: BookmarkNode[]): Array<{ id: string; label: string }> {
  const options: Array<{ id: string; label: string }> = [];
  for (const child of tree[0]?.children ?? []) {
    if (!child.url) {
      collectFolderOptionsRecursive(child, '', options);
    }
  }
  return options;
}

function collectLinkOptions(tree: BookmarkNode[]): Array<{ url: string; label: string }> {
  const options: Array<{ url: string; label: string }> = [];
  for (const child of tree[0]?.children ?? []) {
    collectLinkOptionsRecursive(child, '', options);
  }
  return options;
}

function collectLinkOptionsRecursive(node: BookmarkNode, prefix: string, options: Array<{ url: string; label: string }>): void {
  const nodeLabel = node.title || (node.url ? getHostname(node.url) : 'Untitled');
  const nextPrefix = prefix ? `${prefix} / ${nodeLabel}` : nodeLabel;

  if (node.url) {
    options.push({
      url: node.url,
      label: nextPrefix,
    });
    return;
  }

  for (const child of node.children ?? []) {
    collectLinkOptionsRecursive(child, nextPrefix, options);
  }
}

function resolveInitialIconToolTarget(tree: BookmarkNode[]): string {
  return collectLinkOptions(tree)[0]?.url ?? '';
}

function resolveIconToolTarget(currentValue: string, iconOptions: Array<{ url: string; label: string }>): string {
  if (currentValue && iconOptions.some(option => option.url === currentValue)) {
    return currentValue;
  }
  return iconOptions[0]?.url ?? '';
}

function getBookmarkActionTarget(element: HTMLElement): BookmarkActionTarget | null {
  const id = element.dataset.bookmarkId;
  const url = element.dataset.linkUrl;
  if (!id || !url) {
    return null;
  }

  return {
    id,
    url,
    title: element.dataset.bookmarkTitle || getHostname(url),
  };
}

function getBookmarkLabelForUrl(tree: BookmarkNode[], bookmarkUrl: string): string {
  return collectLinkOptions(tree).find(option => option.url === bookmarkUrl)?.label ?? getHostname(bookmarkUrl);
}

function createClosedIconDialogState(): IconDialogState {
  return {
    open: false,
    target: null,
    query: '',
    remoteUrl: '',
    status: '',
    loading: false,
    results: [],
    previewIcon: null,
  };
}

async function openIconDialog(rootElement: HTMLDivElement, state: AppState, target: BookmarkActionTarget): Promise<void> {
  state.iconDialog = {
    open: true,
    target,
    query: `${target.title || getHostname(target.url)} logo`,
    remoteUrl: '',
    status: '',
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
    renderApp(rootElement, state);
  } catch {
    if (!state.iconDialog.open || state.iconDialog.target?.url !== target.url) {
      return;
    }

    state.iconDialog.loading = false;
    state.iconDialog.results = [];
    state.iconDialog.status = 'Icon search failed. Try a different search or use upload.';
    renderApp(rootElement, state);
  }
}

async function editBookmarkFromContext(rootElement: HTMLDivElement, state: AppState, target: BookmarkActionTarget): Promise<void> {
  const nextTitle = window.prompt('Bookmark title', target.title);
  if (nextTitle === null) {
    renderApp(rootElement, state);
    return;
  }

  const nextUrl = window.prompt('Bookmark URL', target.url);
  if (nextUrl === null) {
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
  renderApp(rootElement, state);
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
    state.currentFolderId = resolveInitialFolderId(state.settings, state.tree);
  }

  if (state.iconDialog.target) {
    const nextTarget = findBookmarkActionTargetById(state.tree, state.iconDialog.target.id);
    if (nextTarget) {
      state.iconDialog.target = nextTarget;
    } else {
      state.iconDialog = createClosedIconDialogState();
    }
  }
}

function findBookmarkActionTargetById(tree: BookmarkNode[], bookmarkId: string): BookmarkActionTarget | null {
  const node = findNodeById(tree, bookmarkId);
  if (!node?.url) {
    return null;
  }

  return {
    id: node.id,
    url: node.url,
    title: node.title || getHostname(node.url),
  };
}

function collectFolderOptionsRecursive(node: BookmarkNode, prefix: string, options: Array<{ id: string; label: string }>): void {
  const label = prefix ? `${prefix} / ${node.title || 'Untitled'}` : (node.title || 'Untitled');
  options.push({ id: node.id, label });
  for (const child of node.children ?? []) {
    if (!child.url) {
      collectFolderOptionsRecursive(child, label, options);
    }
  }
}

function getLibraryFolders(tree: BookmarkNode[]): BookmarkNode[] {
  return tree[0]?.children?.filter(node => !node.url) ?? [];
}

function isFolderDescendantOf(tree: BookmarkNode[], folderId: string, ancestorId: string): boolean {
  return getBreadcrumbs(tree, folderId).some(node => node.id === ancestorId);
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

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Link';
  }
}

function getInitial(value: string): string {
  const trimmed = value.trim();
  return trimmed ? trimmed[0].toUpperCase() : '•';
}

function renderIconPlaceholder(label: string): string {
  return `<span class="bookmark-icon-placeholder">${escapeHtml(getInitial(label))}</span>`;
}

function renderResolvedIconMarkup(icon: ResolvedIcon): string {
  return `<img class="bookmark-icon-image" src="${escapeAttribute(icon.dataUrl)}" alt="" />`;
}

function renderBookmarkVisualIcon(bookmarkUrl: string, label: string, resolvedIcon: ResolvedIcon | undefined, variant: 'tile' | 'dock'): string {
  if (resolvedIcon && resolvedIcon.sourceKind !== 'generated') {
    return renderResolvedIconMarkup(resolvedIcon);
  }

  return renderFaviconIconMarkup(bookmarkUrl, variant);
}

function getFaviconRequestSize(variant: 'tile' | 'dock' | 'dialog'): number {
  const cssSize = variant === 'dock'
    ? dockFaviconCssSize
    : variant === 'dialog'
      ? dialogFaviconCssSize
      : tileFaviconCssSize;
  const devicePixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
  const preferredSize = Math.ceil(cssSize * devicePixelRatio);
  const minimumSize = variant === 'dock' ? 64 : 128;
  return Math.min(maxFaviconRequestSize, Math.max(minimumSize, preferredSize));
}

function getFaviconImageUrl(bookmarkUrl: string, variant: 'tile' | 'dock' | 'dialog' = 'tile'): string {
  return `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(bookmarkUrl)}&sz=${String(getFaviconRequestSize(variant))}`;
}

function renderFaviconIconMarkup(bookmarkUrl: string, variant: 'tile' | 'dock'): string {
  const className = variant === 'tile' ? 'bookmark-icon-image' : 'bookmark-icon-image bookmark-icon-image--dock';
  return `<img class="${className}" src="${escapeAttribute(getFaviconImageUrl(bookmarkUrl))}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
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

function applyResolvedIcon(element: HTMLElement, icon: ResolvedIcon): void {
  const bookmarkUrl = element.dataset.iconUrl;
  if (icon.sourceKind === 'generated' && bookmarkUrl) {
    element.dataset.iconState = 'favicon';
    element.dataset.iconSource = 'favicon';
    element.innerHTML = renderFaviconIconMarkup(bookmarkUrl, element.classList.contains('tile-icon') ? 'tile' : 'dock');
    return;
  }

  element.dataset.iconState = icon.isFallback ? 'fallback' : 'resolved';
  element.dataset.iconSource = icon.sourceKind;
  element.innerHTML = renderResolvedIconMarkup(icon);
}

function applyPendingIcon(element: HTMLElement): void {
  const bookmarkUrl = element.dataset.iconUrl;
  if (bookmarkUrl) {
    element.dataset.iconState = 'favicon';
    element.dataset.iconSource = 'favicon';
    element.innerHTML = renderFaviconIconMarkup(bookmarkUrl, element.classList.contains('tile-icon') ? 'tile' : 'dock');
    return;
  }

  element.dataset.iconState = 'pending';
  const fallbackLabel = element.dataset.iconPlaceholder || '•';
  element.innerHTML = `<span class="bookmark-icon-placeholder">${escapeHtml(fallbackLabel)}</span>`;
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

function renderThemeModeCard(option: { id: Exclude<ThemeMode, 'system'>; label: string; description: string; preview: 'light' | 'dark' }, currentMode: ThemeMode): string {
  const activeMode = resolveAppliedThemeMode(currentMode);
  return `
    <button class="theme-mode-card" data-theme-mode-option="${option.id}" data-active="${String(activeMode === option.id)}" type="button">
      <span class="theme-mode-card__preview theme-mode-card__preview--${option.preview}">
        <span class="theme-mini-window theme-mini-window--top"></span>
        <span class="theme-mini-window theme-mini-window--main"></span>
        <span class="theme-mini-dock"></span>
      </span>
      <span class="theme-mode-card__copy">
        <strong>${option.label}</strong>
        <span>${option.description}</span>
      </span>
    </button>
  `;
}

function renderAccentSwatch(preset: { id: string; label: string; value: string }, currentAccent: string): string {
  return `
    <button class="accent-swatch" data-accent-option="${preset.value}" data-active="${String(preset.value === currentAccent)}" type="button" aria-label="${preset.label}" title="${preset.label}">
      <span class="accent-swatch__band" style="background:linear-gradient(135deg, ${mixHex(preset.value, '#FFFFFF', 0.18)}, ${preset.value})"></span>
      <span class="accent-swatch__label">${preset.label}</span>
    </button>
  `;
}

function applyThemePreview(shell: HTMLElement | null, themeMode: ThemeMode, accentColor: string): void {
  if (!shell) {
    return;
  }
  shell.dataset.themeMode = themeMode;
  shell.dataset.appliedThemeMode = resolveAppliedThemeMode(themeMode);
  shell.setAttribute('style', buildThemeStyle(accentColor));
  const accentPreview = shell.querySelector<HTMLElement>('.accent-preview');
  if (accentPreview) {
    accentPreview.style.background = accentColor;
  }
  const accentTriggerSwatch = shell.querySelector<HTMLElement>('.accent-picker-trigger__swatch');
  if (accentTriggerSwatch) {
    accentTriggerSwatch.style.background = accentColor;
  }
}

function buildThemeStyle(accentColor: string): string {
  const accent = normalizeHexColor(accentColor, defaultAccentColor);
  return [
    `--accent-color: ${accent}`,
    `--accent-color-strong: ${mixHex(accent, '#0B1020', 0.18)}`,
    `--accent-surface: ${mixHex(accent, '#FFFFFF', 0.86)}`,
    `--accent-surface-strong: ${mixHex(accent, '#FFFFFF', 0.72)}`,
    `--accent-shadow: ${hexToRgba(accent, 0.28)}`,
  ].join('; ');
}

function normalizeThemeMode(value: string | undefined): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

function getThemeModeFromInputs(themeModeValue: string | undefined, useSystemTheme: boolean): ThemeMode {
  if (useSystemTheme) {
    return 'system';
  }
  return normalizeThemeMode(themeModeValue) === 'dark' ? 'dark' : 'light';
}

function resolveAppliedThemeMode(themeMode: ThemeMode): Exclude<ThemeMode, 'system'> {
  if (themeMode === 'dark' || themeMode === 'light') {
    return themeMode;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toUpperCase();
  }
  return normalizeHexColor(fallback === value ? defaultAccentColor : fallback, defaultAccentColor);
}

function mixHex(baseHex: string, mixHexValue: string, amount: number): string {
  const base = parseHexColor(baseHex);
  const mix = parseHexColor(mixHexValue);
  const weight = clamp(amount, 0, 1);
  const mixed = {
    red: Math.round(base.red + (mix.red - base.red) * weight),
    green: Math.round(base.green + (mix.green - base.green) * weight),
    blue: Math.round(base.blue + (mix.blue - base.blue) * weight),
  };
  return `#${toHex(mixed.red)}${toHex(mixed.green)}${toHex(mixed.blue)}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const color = parseHexColor(hex);
  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${clamp(alpha, 0, 1)})`;
}

function parseHexColor(hex: string): { red: number; green: number; blue: number } {
  const normalized = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : defaultAccentColor;
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
