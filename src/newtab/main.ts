import './styles.css';
import { sendRuntimeMessage } from '../shared/browser';
import { messageTypes, type AppSettings, type BookmarkNode, type GetBookmarkTreeResponse, type GetSettingsResponse, type PatchSettingsResponse, type PingResponse, type SettingsSectionId, type ThemeMode } from '../shared/messages';

const root = document.querySelector<HTMLDivElement>('#app');
const lastFolderStorageKey = 'newtab/last-folder';
const defaultAccentColor = '#3F72DC';
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
}

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
  };

  syncFolderHash(state.currentFolderId);
  persistLastFolder(state.settings, state.currentFolderId);
  renderApp(rootElement, state);

  window.addEventListener('hashchange', () => {
    const folderId = getFolderIdFromHash();
    if (!folderId || folderId === state.currentFolderId || !getFolderNode(state.tree, folderId)) {
      return;
    }
    state.currentFolderId = folderId;
    persistLastFolder(state.settings, folderId);
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
  const activeSection = state.settings.settingsSection;
  const themeMode = normalizeThemeMode(state.settings.themeMode);
  const accentColor = normalizeHexColor(state.settings.accentColor, defaultAccentColor);

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
            ${canvasItems.map(renderBookmarkTile).join('') || '<p class="empty-state">This folder is empty.</p>'}
          </div>
        </section>
        ${state.settings.showDock ? `
          <aside class="bookmark-dock" aria-label="Dock">
            <div class="dock-header">
              <span>${escapeHtml(dockFolder?.title || 'Dock')}</span>
              <button class="dock-settings-link" type="button">Customize</button>
            </div>
            <div class="dock-strip">
              ${dockItems.map(renderDockItem).join('') || '<p class="dock-empty">Choose a dock folder in settings.</p>'}
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
            ${renderDrawerSection(activeSection, state.settings, allFolderOptions)}
            <div class="drawer-actions">
              <button class="save-button" type="button">Save</button>
            </div>
          </section>
        </div>
      </aside>
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
  const themeModeButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-theme-mode-option]');
  const accentButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-accent-option]');
  const folderButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-folder-id]');
  const linkButtons = rootElement.querySelectorAll<HTMLButtonElement>('[data-link-url]');

  const setDrawerOpen = (isOpen: boolean) => {
    state.drawerOpen = isOpen;
    drawer?.setAttribute('data-open', String(isOpen));
  };

  homeButton?.addEventListener('click', () => {
    const targetId = state.settings.rootFolderId || getDefaultFolder(state.tree, state.settings.rootFolderId)?.id;
    if (!targetId) {
      return;
    }
    navigateToFolder(state, targetId);
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
    button.addEventListener('click', () => {
      const folderId = button.dataset.folderId;
      if (!folderId) {
        return;
      }
      navigateToFolder(state, folderId);
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
    renderApp(rootElement, state);
  });
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

function renderBookmarkTile(node: BookmarkNode): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    return `
      <button class="bookmark-tile link-tile" data-link-url="${escapeAttribute(node.url)}" type="button">
        <div class="tile-icon">${escapeHtml(getInitial(label))}</div>
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

function renderDockItem(node: BookmarkNode): string {
  if (node.url) {
    const label = node.title || getHostname(node.url);
    return `
      <button class="dock-item" data-link-url="${escapeAttribute(node.url)}" type="button">
        <span class="dock-item__icon">${escapeHtml(getInitial(label))}</span>
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

function renderDrawerSection(section: SettingsSectionId, settings: AppSettings, folderOptions: Array<{ id: string; label: string }>): string {
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
  `;
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
