import type { AppSettings, LayoutPresetId, SettingsSectionId, ThemeMode } from '../shared/messages';
import { escapeAttribute, escapeHtml } from '../newtab/html';
import { renderUiIcon, type UiIconName } from '../newtab/ui-icons';

export const defaultAccentColor = '#3F72DC';

export const accentPresets = [
  { id: 'blue', label: 'Blue', value: '#3F72DC' },
  { id: 'teal', label: 'Teal', value: '#23867B' },
  { id: 'green', label: 'Green', value: '#2F8F4E' },
  { id: 'lime', label: 'Lime', value: '#7BAE2C' },
  { id: 'yellow', label: 'Yellow', value: '#C9A227' },
  { id: 'orange', label: 'Orange', value: '#F57C00' },
  { id: 'red', label: 'Red', value: '#C75252' },
  { id: 'rose', label: 'Rose', value: '#C96A7D' },
  { id: 'pink', label: 'Pink', value: '#C85FA4' },
  { id: 'purple', label: 'Purple', value: '#7D60D8' },
  { id: 'slate', label: 'Slate', value: '#778292' },
  { id: 'graphite', label: 'Graphite', value: '#4B5360' },
] as const;

export const themeModeOptions: Array<{ id: Exclude<ThemeMode, 'system'>; label: string; description: string; preview: 'light' | 'dark' }> = [
  { id: 'light', label: 'Light', description: 'Bright workspace', preview: 'light' },
  { id: 'dark', label: 'Dark', description: 'Low-glare workspace', preview: 'dark' },
];

export type GeneralSettingsSubpage = 'general' | 'layout' | 'dock';

export const layoutPresetOptions: Array<{
  id: Exclude<LayoutPresetId, 'custom'>;
  label: string;
  description: string;
  settings: Pick<AppSettings, 'favoritesColumns' | 'favoritesRows' | 'favoritesColumnGap' | 'favoritesRowGap' | 'bookmarkTileWidth' | 'bookmarkIconSize'>;
}> = [
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A comfortable all-purpose grid.',
    settings: {
      favoritesColumns: 10,
      favoritesRows: 0,
      favoritesColumnGap: 24,
      favoritesRowGap: 20,
      bookmarkTileWidth: 130,
      bookmarkIconSize: 75,
    },
  },
  {
    id: 'compact',
    label: 'Compact',
    description: 'Fit more bookmarks on screen at once.',
    settings: {
      favoritesColumns: 12,
      favoritesRows: 0,
      favoritesColumnGap: 16,
      favoritesRowGap: 14,
      bookmarkTileWidth: 108,
      bookmarkIconSize: 60,
    },
  },
  {
    id: 'spacious',
    label: 'Spacious',
    description: 'Larger tiles with more breathing room.',
    settings: {
      favoritesColumns: 8,
      favoritesRows: 0,
      favoritesColumnGap: 28,
      favoritesRowGap: 24,
      bookmarkTileWidth: 146,
      bookmarkIconSize: 82,
    },
  },
  {
    id: 'presentation',
    label: 'Presentation',
    description: 'Big visuals for wall displays and touch use.',
    settings: {
      favoritesColumns: 6,
      favoritesRows: 0,
      favoritesColumnGap: 32,
      favoritesRowGap: 28,
      bookmarkTileWidth: 168,
      bookmarkIconSize: 96,
    },
  },
];

const shortcutGroups = [
  {
    label: 'Selection',
    items: [
      { keys: 'Ctrl/Cmd+Click', description: 'Add or remove a single item from the selection.' },
      { keys: 'Drag on empty space', description: 'Create a marquee selection in the current surface.' },
      { keys: 'Escape', description: 'Clear the selection or dismiss the current overlay.' },
    ],
  },
  {
    label: 'Clipboard',
    items: [
      { keys: 'Ctrl/Cmd+C', description: 'Copy the current selection.' },
      { keys: 'Ctrl/Cmd+X', description: 'Cut the current selection.' },
      { keys: 'Ctrl/Cmd+V', description: 'Paste into the current folder.' },
    ],
  },
  {
    label: 'History',
    items: [
      { keys: 'Ctrl/Cmd+Z', description: 'Undo the last delete or move.' },
      { keys: 'Ctrl/Cmd+Shift+Z', description: 'Redo the last undone action.' },
      { keys: 'Ctrl/Cmd+Y', description: 'Redo on keyboards that use the alternate shortcut.' },
    ],
  },
  {
    label: 'Actions',
    items: [
      { keys: 'Delete / Backspace', description: 'Delete the current selection.' },
      { keys: 'Ctrl/Cmd+Click', description: 'Open a bookmark or folder in a new tab.' },
    ],
  },
] as const;

export interface AccentPickerState {
  open: boolean;
  draftColor: string;
  hue: number;
  saturation: number;
  lightness: number;
}

export function renderSectionButton(section: SettingsSectionId, currentSection: SettingsSectionId, label: string, iconName: UiIconName): string {
  return `<button class="section-button button-with-icon" data-section="${section}" data-active="${String(section === currentSection)}" type="button">${renderUiIcon(iconName)}<span>${label}</span></button>`;
}

export function renderDrawerSection(section: SettingsSectionId, settings: AppSettings, folderOptions: Array<{ id: string; label: string }>, generalSubpage: GeneralSettingsSubpage, accentPicker: AccentPickerState): string {
  if (section === 'general') {
    return `
      <div class="drawer-panel">
        <div class="settings-subnav" role="tablist" aria-label="General settings subpages">
          ${renderGeneralSubpageButton('general', generalSubpage, 'General')}
          ${renderGeneralSubpageButton('layout', generalSubpage, 'Layout')}
          ${renderGeneralSubpageButton('dock', generalSubpage, 'Dock')}
        </div>
        ${renderGeneralSubpageSection(settings, folderOptions, generalSubpage)}
      </div>
    `;
  }

  if (section === 'help') {
    return renderHelpSection();
  }

  const accentColor = normalizeHexColor(settings.accentColor, defaultAccentColor);
  const customAccentActive = !accentPresets.some(preset => preset.value === accentColor);
  const hasCustomBackground = Boolean(settings.customBackgroundImage);
  return `
    <div class="drawer-panel">
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
        </label>
        <div class="theme-mode-grid" role="group" aria-label="Theme mode">
          ${themeModeOptions.map(option => renderThemeModeCard(option, settings.themeMode)).join('')}
        </div>
      </div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Accent</h3>
          <p class="field-hint">Choose from a palette that already works well, or open the custom picker.</p>
        </div>
        <div class="accent-gallery" role="group" aria-label="Accent presets">
          ${accentPresets.map(preset => renderAccentSwatch(preset, accentColor)).join('')}
          <button class="accent-swatch accent-swatch--custom" data-accent-option="custom" data-active="${String(customAccentActive || accentPicker.open)}" type="button">
            <span class="accent-swatch__custom-preview"></span>
            <span class="accent-swatch__label">Custom</span>
          </button>
        </div>
        <input name="accentColor" type="hidden" value="${accentColor}" />
        ${renderAccentPickerPopover(accentPicker)}
      </div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Background</h3>
          <p class="field-hint">You can use your own background image if you want.</p>
        </div>
        <div class="field field--card background-upload-card">
          <div class="background-upload-card__actions">
            <button class="save-button button-with-icon background-upload-button" type="button">${renderUiIcon('upload')}<span>Upload image</span></button>
            ${hasCustomBackground
      ? `<div class="background-upload-card__preview" data-has-image="true">
              <img class="background-upload-card__preview-image" src="${escapeAttribute(settings.customBackgroundImage)}" alt="" />
              <button class="icon-button background-remove-button" type="button" aria-label="Remove custom background" title="Remove custom background">${renderUiIcon('trash')}</button>
            </div>`
      : ''}
          </div>
          ${hasCustomBackground
      ? `${renderSettingsSlider('backgroundOpacity', 'Background opacity', settings.backgroundOpacity, 0, 100, '%')}
          <label class="field background-upload-card__field">
            <span>Fit</span>
            <select name="backgroundFitMode">
              <option value="cover" ${settings.backgroundFitMode === 'cover' ? 'selected' : ''}>Cover (crop to fill)</option>
              <option value="contain" ${settings.backgroundFitMode === 'contain' ? 'selected' : ''}>Contain (fit inside)</option>
              <option value="fill" ${settings.backgroundFitMode === 'fill' ? 'selected' : ''}>Fill (stretch)</option>
            </select>
          </label>
          <label class="field background-upload-card__field">
            <span>Position</span>
            <select name="backgroundPositionMode">
              <option value="center" ${settings.backgroundPositionMode === 'center' ? 'selected' : ''}>Center</option>
              <option value="top" ${settings.backgroundPositionMode === 'top' ? 'selected' : ''}>Top</option>
              <option value="bottom" ${settings.backgroundPositionMode === 'bottom' ? 'selected' : ''}>Bottom</option>
            </select>
          </label>`
      : ''}
          <input class="icon-file-input" name="customBackgroundImageFile" type="file" accept="image/*" />
        </div>
      </div>
    </div>
  `;
}

export function buildShellStyle(settings: AppSettings): string {
  const accent = normalizeHexColor(settings.accentColor, defaultAccentColor);
  const columns = clamp(settings.favoritesColumns, 3, 12);
  const rows = clamp(settings.favoritesRows, 0, 8);
  const columnGap = clamp(settings.favoritesColumnGap, 0, 48);
  const rowGap = clamp(settings.favoritesRowGap, 0, 48);
  const tileWidth = clamp(settings.bookmarkTileWidth, 80, 160);
  const iconSize = clamp(settings.bookmarkIconSize, 40, 120);
  const dockIconSize = Math.round(clamp(iconSize * 0.5, 28, 40));
  return [
    `--accent-color: ${accent}`,
    `--accent-color-strong: ${mixHex(accent, '#0B1020', 0.18)}`,
    `--accent-surface: ${mixHex(accent, '#FFFFFF', 0.86)}`,
    `--accent-surface-strong: ${mixHex(accent, '#FFFFFF', 0.72)}`,
    `--accent-shadow: ${hexToRgba(accent, 0.28)}`,
    `--bookmark-grid-columns: ${String(columns)}`,
    `--bookmark-grid-max-rows: ${String(rows)}`,
    `--bookmark-grid-column-gap: ${String(columnGap)}px`,
    `--bookmark-grid-row-gap: ${String(rowGap)}px`,
    `--bookmark-tile-width: ${String(tileWidth)}px`,
    `--bookmark-icon-size: ${String(iconSize)}px`,
    `--dock-icon-size: ${String(dockIconSize)}px`,
    `--bookmark-row-height: ${String(iconSize + 54)}px`,
    `--custom-background-image: ${settings.customBackgroundImage ? `url("${escapeCssUrl(settings.customBackgroundImage)}")` : 'none'}`,
  ].join('; ');
}

function escapeCssUrl(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function normalizeThemeMode(value: string | undefined): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return 'system';
}

export function resolveAppliedThemeMode(themeMode: ThemeMode): Exclude<ThemeMode, 'system'> {
  if (themeMode === 'dark' || themeMode === 'light') {
    return themeMode;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function normalizeGeneralSubpage(value: string | undefined): GeneralSettingsSubpage {
  if (value === 'layout' || value === 'dock' || value === 'general') {
    return value;
  }
  return 'general';
}

export function getLayoutPresetPatch(layoutPreset: Exclude<LayoutPresetId, 'custom'>): Partial<AppSettings> {
  const preset = layoutPresetOptions.find(option => option.id === layoutPreset);
  if (!preset) {
    return { layoutPreset: 'balanced' };
  }

  return {
    layoutPreset: preset.id,
    ...preset.settings,
  };
}

export function createAccentPickerState(color: string): AccentPickerState {
  const draftColor = normalizeHexColor(color, defaultAccentColor);
  const hsl = hexToHsl(draftColor);
  return {
    open: false,
    draftColor,
    hue: hsl.hue,
    saturation: hsl.saturation,
    lightness: hsl.lightness,
  };
}

export function normalizeHexColor(value: string | undefined, fallback: string): string {
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) {
    return value.toUpperCase();
  }
  return normalizeHexColor(fallback === value ? defaultAccentColor : fallback, defaultAccentColor);
}

function renderAccentPickerPopover(picker: AccentPickerState): string {
  return `
    <section class="accent-picker-popover" data-open="${String(picker.open)}" aria-label="Custom accent color">
      <div class="accent-picker-popover__header">
        <div>
          <strong>Custom accent</strong>
          <span>Set hue, saturation, and lightness without leaving the drawer.</span>
        </div>
        <button class="accent-picker-popover__close icon-button" type="button" aria-label="Close custom accent picker">${renderUiIcon('close')}</button>
      </div>
      <div class="accent-picker-popover__body">
        <div class="accent-picker-popover__preview-column">
          <div class="accent-picker-popover__preview" style="background: ${picker.draftColor}"></div>
          <label class="accent-hex-field accent-hex-field--popover">
            <span>Hex</span>
            <input name="accentHex" type="text" value="${picker.draftColor}" spellcheck="false" />
          </label>
        </div>
        <div class="accent-picker-popover__sliders">
          ${renderAccentControlSlider('accentPickerHue', 'Hue', Math.round(picker.hue), 0, 360, 'deg')}
          ${renderAccentControlSlider('accentPickerSaturation', 'Saturation', Math.round(picker.saturation), 0, 100, '%')}
          ${renderAccentControlSlider('accentPickerLightness', 'Lightness', Math.round(picker.lightness), 0, 100, '%')}
        </div>
      </div>
    </section>
  `;
}

function renderAccentControlSlider(name: string, label: string, value: number, min: number, max: number, suffix: string): string {
  return `
    <label class="accent-control-slider">
      <span class="accent-control-slider__meta">
        <span>${label}</span>
        <span data-slider-value-for="${name}">${String(value)}${suffix}</span>
      </span>
      <input class="accent-control-slider__input accent-control-slider__input--${name}" name="${name}" type="range" min="${String(min)}" max="${String(max)}" step="1" value="${String(value)}" />
    </label>
  `;
}

function renderGeneralSubpageButton(subpage: GeneralSettingsSubpage, currentSubpage: GeneralSettingsSubpage, label: string): string {
  return `<button class="settings-subnav__button" data-general-subpage="${subpage}" data-active="${String(subpage === currentSubpage)}" type="button">${label}</button>`;
}

function renderGeneralSubpageSection(settings: AppSettings, folderOptions: Array<{ id: string; label: string }>, subpage: GeneralSettingsSubpage): string {
  if (subpage === 'layout') {
    const activePreset = settings.layoutPreset;
    return `
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Layout</h3>
          <p class="field-hint">Choose a layout preset first, or switch to custom controls for exact spacing and sizing.</p>
        </div>
        <div class="layout-preset-grid" role="group" aria-label="Layout presets">
          ${layoutPresetOptions.map(option => renderLayoutPresetCard(option, activePreset)).join('')}
          <button class="layout-preset-card layout-preset-card--custom" data-layout-preset-option="custom" data-active="${String(activePreset === 'custom')}" type="button">
            <span class="layout-preset-card__preview layout-preset-card__preview--custom">
              <span class="layout-preset-card__tile layout-preset-card__tile--custom a"></span>
              <span class="layout-preset-card__tile layout-preset-card__tile--custom b"></span>
              <span class="layout-preset-card__tile layout-preset-card__tile--custom c"></span>
              <span class="layout-preset-card__tile layout-preset-card__tile--custom d"></span>
            </span>
            <span class="layout-preset-card__copy">
              <strong>Custom</strong>
              <span>Tune columns, gaps, tile width, and icon size manually.</span>
            </span>
          </button>
        </div>
        ${activePreset === 'custom'
          ? `<div class="settings-slider-grid">
              ${renderSettingsSlider('favoritesColumns', 'Columns', settings.favoritesColumns, 3, 12)}
              ${renderSettingsSlider('favoritesRows', 'Rows', settings.favoritesRows, 0, 8)}
              ${renderSettingsSlider('favoritesColumnGap', 'Column gap', settings.favoritesColumnGap, 0, 48, 'px')}
              ${renderSettingsSlider('favoritesRowGap', 'Row gap', settings.favoritesRowGap, 0, 48, 'px')}
              ${renderSettingsSlider('bookmarkTileWidth', 'Tile width', settings.bookmarkTileWidth, 88, 180, 'px')}
              ${renderSettingsSlider('bookmarkIconSize', 'Icon size', settings.bookmarkIconSize, 40, 112, 'px')}
            </div>`
          : `<p class="field-hint">Switch to Custom if you want to fine-tune spacing, row limits, and icon treatment.</p>`}
        <label class="toggle-field toggle-field--card">
          <input name="showBookmarkIconBackground" type="checkbox" ${settings.showBookmarkIconBackground ? 'checked' : ''} />
          <span>Show accent background behind bookmark icons</span>
        </label>
      </div>
    `;
  }

  if (subpage === 'dock') {
    return `
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Dock</h3>
          <p class="field-hint">Pin a folder to the bottom dock to keep visual previews of favorite folders and links centered on the page.</p>
        </div>
        <label class="toggle-field toggle-field--card">
          <input name="showDock" type="checkbox" ${settings.showDock ? 'checked' : ''} />
          <span>Show the bookmark dock at the bottom of the page</span>
        </label>
        <label class="toggle-field toggle-field--card">
          <input name="autoHideDock" type="checkbox" ${settings.autoHideDock ? 'checked' : ''} />
          <span>Auto-hide the dock until the bottom edge is hovered or focused</span>
        </label>
        <label class="field field--card">
          <span>Dock folder</span>
          <select name="dockFolderId">
            <option value="">Mirror the main library root</option>
            ${folderOptions.map(option => `<option value="${option.id}" ${option.id === settings.dockFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
      </div>
    `;
  }

  return `
    <div class="visual-section">
      <div class="visual-section__header">
        <h3>General</h3>
        <p class="field-hint">These settings apply immediately and persist automatically.</p>
      </div>
      <label class="field field--card">
        <span>Starting folder</span>
        <select name="rootFolderId">
          <option value="">Default library root</option>
          ${folderOptions.map(option => `<option value="${option.id}" ${option.id === settings.rootFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
      </label>
      <label class="toggle-field toggle-field--card">
        <input name="rememberLastFolder" type="checkbox" ${settings.rememberLastFolder ? 'checked' : ''} />
        <span>Reopen the last visited folder when possible</span>
      </label>
      <label class="toggle-field toggle-field--card">
        <input name="openLinksInNewTab" type="checkbox" ${settings.openLinksInNewTab ? 'checked' : ''} />
        <span>Open links in a new tab instead of replacing the new tab page</span>
      </label>
    </div>
  `;
}

function renderHelpSection(): string {
  return `
    <div class="drawer-panel drawer-panel--help">
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>About</h3>
          <p class="field-hint">Flipp's Favorites keeps bookmark navigation, organization, and visual customization inside the new tab page.</p>
        </div>
        <div class="shortcut-card">
          <div class="shortcut-list">
            <div class="shortcut-row">
              <span class="shortcut-keys">New tab</span>
              <span class="shortcut-description">Browse folders, reorder items, edit bookmarks, and keep a dock of favorite folders visible at the bottom of the page.</span>
            </div>
            <div class="shortcut-row">
              <span class="shortcut-keys">Theme</span>
              <span class="shortcut-description">Light, dark, accent, background image, and layout presets are all available from the right-side drawer.</span>
            </div>
          </div>
        </div>
      </div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Shortcuts</h3>
          <p class="field-hint">These shortcuts work on the main new-tab surface when a text field or settings control is not focused.</p>
        </div>
        <div class="shortcut-groups">
          ${shortcutGroups.map(group => `
            <section class="shortcut-card">
              <h4>${group.label}</h4>
              <div class="shortcut-list">
                ${group.items.map(item => `
                  <div class="shortcut-row">
                    <span class="shortcut-keys">${item.keys}</span>
                    <span class="shortcut-description">${item.description}</span>
                  </div>
                `).join('')}
              </div>
            </section>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function renderLayoutPresetCard(
  option: typeof layoutPresetOptions[number],
  activePreset: LayoutPresetId,
): string {
  return `
    <button class="layout-preset-card" data-layout-preset-option="${option.id}" data-active="${String(activePreset === option.id)}" type="button">
      <span class="layout-preset-card__preview layout-preset-card__preview--${option.id}">
        <span class="layout-preset-card__tile layout-preset-card__tile--${option.id} a"></span>
        <span class="layout-preset-card__tile layout-preset-card__tile--${option.id} b"></span>
        <span class="layout-preset-card__tile layout-preset-card__tile--${option.id} c"></span>
        <span class="layout-preset-card__tile layout-preset-card__tile--${option.id} d"></span>
      </span>
      <span class="layout-preset-card__copy">
        <strong>${option.label}</strong>
        <span>${option.description}</span>
      </span>
    </button>
  `;
}

function renderSettingsSlider(name: string, label: string, value: number, min: number, max: number, suffix = ''): string {
  return `
    <label class="settings-slider">
      <span class="settings-slider__meta">
        <span>${label}</span>
        <span class="settings-slider__value" data-slider-value-for="${name}">${String(value)}${suffix}</span>
      </span>
      <input class="settings-slider__input" name="${name}" type="range" min="${String(min)}" max="${String(max)}" step="1" value="${String(value)}" />
      <span class="settings-slider__bounds"><span>${String(min)}${suffix}</span><span>${String(max)}${suffix}</span></span>
    </label>
  `;
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

function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } {
  const { red, green, blue } = parseHexColor(hex);
  const redUnit = red / 255;
  const greenUnit = green / 255;
  const blueUnit = blue / 255;
  const max = Math.max(redUnit, greenUnit, blueUnit);
  const min = Math.min(redUnit, greenUnit, blueUnit);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness: Math.round(lightness * 100) };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;

  switch (max) {
    case redUnit:
      hue = (greenUnit - blueUnit) / delta + (greenUnit < blueUnit ? 6 : 0);
      break;
    case greenUnit:
      hue = (blueUnit - redUnit) / delta + 2;
      break;
    default:
      hue = (redUnit - greenUnit) / delta + 4;
      break;
  }

  return {
    hue: Math.round((hue / 6) * 360),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100),
  };
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}

export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const normalizedSaturation = clamp(saturation, 0, 100) / 100;
  const normalizedLightness = clamp(lightness, 0, 100) / 100;

  if (normalizedSaturation === 0) {
    const channel = Math.round(normalizedLightness * 255);
    return `#${toHex(channel)}${toHex(channel)}${toHex(channel)}`;
  }

  const q = normalizedLightness < 0.5
    ? normalizedLightness * (1 + normalizedSaturation)
    : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;
  const hueUnit = normalizedHue / 360;
  const red = hueToRgb(p, q, hueUnit + (1 / 3));
  const green = hueToRgb(p, q, hueUnit);
  const blue = hueToRgb(p, q, hueUnit - (1 / 3));

  return `#${toHex(Math.round(red * 255))}${toHex(Math.round(green * 255))}${toHex(Math.round(blue * 255))}`;
}

function hueToRgb(p: number, q: number, t: number): number {
  let next = t;
  if (next < 0) {
    next += 1;
  }
  if (next > 1) {
    next -= 1;
  }
  if (next < 1 / 6) {
    return p + (q - p) * 6 * next;
  }
  if (next < 1 / 2) {
    return q;
  }
  if (next < 2 / 3) {
    return p + (q - p) * ((2 / 3) - next) * 6;
  }
  return p;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
