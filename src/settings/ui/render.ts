import type { AppSettings, LayoutPresetId, SettingsSectionId, ThemeMode } from '../../shared/messages';
import { escapeAttribute, escapeHtml } from '../../shared/html-escape';
import { renderUiIcon, type UiIconName } from '../../shared/ui-icons';
import {
  accentPresets,
  defaultAccentColor,
  getShortcutGroups,
  layoutPresetOptions,
  themeModeOptions,
  type GeneralSettingsSubpage,
} from '../config/options';
import { t } from '../../shared/i18n';
import type { TranslationKey } from '../../locales/en';

export { accentPresets, defaultAccentColor, layoutPresetOptions, themeModeOptions };
export type { GeneralSettingsSubpage };

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
        <div class="settings-subnav" role="tablist" aria-label="${t('settings.general.tabs.aria-label')}">
          ${renderGeneralSubpageButton('general', generalSubpage, t('settings.general.tab.general'))}
          ${renderGeneralSubpageButton('layout', generalSubpage, t('settings.general.tab.layout'))}
          ${renderGeneralSubpageButton('dock', generalSubpage, t('settings.general.tab.dock'))}
        </div>
        ${renderGeneralSubpageSection(settings, folderOptions, generalSubpage)}
      </div>
    `;
  }

  if (section === 'backup') {
    return renderBackupSection();
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
          <h3>${t('settings.theme.heading')}</h3>
          <p class="field-hint">${t('settings.theme.hint')}</p>
        </div>
        <label class="system-theme-card" data-active="${String(settings.themeMode === 'system')}">
          <input name="useSystemTheme" type="checkbox" ${settings.themeMode === 'system' ? 'checked' : ''} />
          <span class="system-theme-card__copy">
            <strong>${t('settings.theme.system-label')}</strong>
            <span>${t('settings.theme.system-description')}</span>
          </span>
        </label>
        <div class="theme-mode-grid" role="group" aria-label="${t('settings.theme.mode-group.aria-label')}">
          ${themeModeOptions.map(option => renderThemeModeCard(option, settings.themeMode)).join('')}
        </div>
      </div>
      <div class="settings-section-divider" aria-hidden="true"></div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.theme.accent-heading')}</h3>
          <p class="field-hint">${t('settings.theme.accent-hint')}</p>
        </div>
        <div class="accent-gallery" role="group" aria-label="${t('settings.theme.accent-group.aria-label')}">
          ${accentPresets.map(preset => renderAccentSwatch(preset, accentColor)).join('')}
          <button class="accent-swatch accent-swatch--custom" data-accent-option="custom" data-active="${String(customAccentActive || accentPicker.open)}" type="button">
            <span class="accent-swatch__custom-preview"></span>
            <span class="accent-swatch__label">${t('settings.theme.accent-custom-label')}</span>
          </button>
        </div>
        <input name="accentColor" type="hidden" value="${accentColor}" />
        ${renderAccentPickerPopover(accentPicker)}
        <label class="toggle-field toggle-field--card">
          <input name="showBookmarkIconBackground" type="checkbox" ${settings.showBookmarkIconBackground ? 'checked' : ''} />
          <span>${t('settings.theme.icon-background')}</span>
        </label>
      </div>
      <div class="settings-section-divider" aria-hidden="true"></div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.theme.background-heading')}</h3>
          <p class="field-hint">${t('settings.theme.background-hint')}</p>
        </div>
        <label class="toggle-field toggle-field--card">
          <input name="showAccentBackground" type="checkbox" ${settings.showAccentBackground ? 'checked' : ''} />
          <span>${t('settings.theme.background-accent')}</span>
        </label>
        <div class="field field--card background-upload-card">
          <div class="background-upload-card__actions">
            <button class="save-button button-with-icon background-upload-button" type="button">${renderUiIcon('upload')}<span>${t('settings.theme.background-upload')}</span></button>
            ${hasCustomBackground
      ? `<div class="background-upload-card__preview" data-has-image="true">
              <img class="background-upload-card__preview-image" src="${escapeAttribute(settings.customBackgroundImage)}" alt="" />
              <button class="icon-button background-remove-button" type="button" aria-label="${t('settings.theme.background-remove.aria-label')}" title="${t('settings.theme.background-remove.title')}">${renderUiIcon('trash')}</button>
            </div>`
      : ''}
          </div>
          ${hasCustomBackground
      ? `${renderSettingsSlider('backgroundOpacity', t('settings.theme.background-opacity.label'), settings.backgroundOpacity, 0, 100, '%')}
          <label class="field background-upload-card__field">
            <span>${t('settings.theme.background-fit.label')}</span>
            <select name="backgroundFitMode">
              <option value="cover" ${settings.backgroundFitMode === 'cover' ? 'selected' : ''}>${t('settings.theme.background-fit.cover')}</option>
              <option value="contain" ${settings.backgroundFitMode === 'contain' ? 'selected' : ''}>${t('settings.theme.background-fit.contain')}</option>
              <option value="fill" ${settings.backgroundFitMode === 'fill' ? 'selected' : ''}>${t('settings.theme.background-fit.fill')}</option>
            </select>
          </label>
          <label class="field background-upload-card__field">
            <span>${t('settings.theme.background-position.label')}</span>
            <select name="backgroundPositionMode">
              <option value="center" ${settings.backgroundPositionMode === 'center' ? 'selected' : ''}>${t('settings.theme.background-position.center')}</option>
              <option value="top" ${settings.backgroundPositionMode === 'top' ? 'selected' : ''}>${t('settings.theme.background-position.top')}</option>
              <option value="bottom" ${settings.backgroundPositionMode === 'bottom' ? 'selected' : ''}>${t('settings.theme.background-position.bottom')}</option>
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
    `--accent-bg-color: ${settings.showAccentBackground ? accent : 'transparent'}`,
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
    <section class="accent-picker-popover" data-open="${String(picker.open)}" aria-label="${t('settings.accent-picker.aria-label')}">
      <div class="accent-picker-popover__header">
        <div>
          <strong>${t('settings.accent-picker.heading')}</strong>
          <span>${t('settings.accent-picker.description')}</span>
        </div>
        <button class="accent-picker-popover__close icon-button" type="button" aria-label="${t('settings.accent-picker.close.aria-label')}">${renderUiIcon('close')}</button>
      </div>
      <div class="accent-picker-popover__body">
        <div class="accent-picker-popover__preview-column">
          <div class="accent-picker-popover__preview" style="background: ${picker.draftColor}"></div>
          <label class="accent-hex-field accent-hex-field--popover">
            <span>${t('settings.accent-picker.hex-label')}</span>
            <input name="accentHex" type="text" value="${picker.draftColor}" spellcheck="false" />
          </label>
        </div>
        <div class="accent-picker-popover__sliders">
          ${renderAccentControlSlider('accentPickerHue', t('settings.accent-picker.hue'), Math.round(picker.hue), 0, 360, 'deg')}
          ${renderAccentControlSlider('accentPickerSaturation', t('settings.accent-picker.saturation'), Math.round(picker.saturation), 0, 100, '%')}
          ${renderAccentControlSlider('accentPickerLightness', t('settings.accent-picker.lightness'), Math.round(picker.lightness), 0, 100, '%')}
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
          <h3>${t('settings.layout.heading')}</h3>
          <p class="field-hint">${t('settings.layout.hint')}</p>
        </div>
        <div class="layout-preset-grid" role="group" aria-label="${t('settings.layout.presets.aria-label')}">
          ${layoutPresetOptions.map(option => renderLayoutPresetCard(option, activePreset)).join('')}
          <button class="layout-preset-card layout-preset-card--custom" data-layout-preset-option="custom" data-active="${String(activePreset === 'custom')}" type="button">
            <span class="layout-preset-card__preview layout-preset-card__preview--custom">
              <span class="layout-preset-card__tile layout-preset-card__tile--custom a"></span>
              <span class="layout-preset-card__tile layout-preset-card__tile--custom b"></span>
              <span class="layout-preset-card__tile layout-preset-card__tile--custom c"></span>
              <span class="layout-preset-card__tile layout-preset-card__tile--custom d"></span>
            </span>
            <span class="layout-preset-card__copy">
              <strong>${t('settings.layout.custom.label')}</strong>
              <span>${t('settings.layout.custom.description')}</span>
            </span>
          </button>
        </div>
        ${activePreset === 'custom'
          ? `<div class="settings-slider-grid">
              ${renderSettingsSlider('favoritesColumns', t('settings.layout.slider.columns'), settings.favoritesColumns, 3, 12)}
              ${renderSettingsSlider('favoritesRows', t('settings.layout.slider.rows'), settings.favoritesRows, 0, 8)}
              ${renderSettingsSlider('favoritesColumnGap', t('settings.layout.slider.column-gap'), settings.favoritesColumnGap, 0, 48, 'px')}
              ${renderSettingsSlider('favoritesRowGap', t('settings.layout.slider.row-gap'), settings.favoritesRowGap, 0, 48, 'px')}
              ${renderSettingsSlider('bookmarkTileWidth', t('settings.layout.slider.tile-width'), settings.bookmarkTileWidth, 88, 180, 'px')}
              ${renderSettingsSlider('bookmarkIconSize', t('settings.layout.slider.icon-size'), settings.bookmarkIconSize, 40, 112, 'px')}
            </div>`
          : ``}
      </div>
    `;
  }

  if (subpage === 'dock') {
    const dockVisibilityMode = settings.showDock && settings.autoHideDock ? 'hover' : 'always';
    const selectedDockFolderId = resolveDockFolderSelection(folderOptions, settings.dockFolderId);
    return `
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.dock.heading')}</h3>
          <p class="field-hint">${t('settings.dock.hint')}</p>
        </div>
         <label class="field field--card">
          <span>${t('settings.dock.folder-label')}</span>
          <select name="dockFolderId">
            ${folderOptions.map(option => `<option value="${option.id}" ${option.id === selectedDockFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
        <div class="field field--card">
          <span>${t('settings.dock.visibility-label')}</span>
          <div class="settings-subnav" role="group" aria-label="${t('settings.dock.visibility.aria-label')}">
            <button class="settings-subnav__button" data-dock-visibility-option="always" data-active="${String(dockVisibilityMode === 'always')}" type="button">${t('settings.dock.visibility.always')}</button>
            <button class="settings-subnav__button" data-dock-visibility-option="hover" data-active="${String(dockVisibilityMode === 'hover')}" type="button">${t('settings.dock.visibility.hover')}</button>
          </div>
          <p class="field-hint">${t('settings.dock.visibility.hint')}</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="visual-section">
      <div class="visual-section__header">
        <h3>${t('settings.general.heading')}</h3>
        <p class="field-hint">${t('settings.general.hint')}</p>
      </div>
      <label class="field field--card">
        <span>${t('settings.general.starting-folder')}</span>
        <select name="rootFolderId">
          <option value="">${t('settings.general.default-library-root')}</option>
          ${folderOptions.map(option => `<option value="${option.id}" ${option.id === settings.rootFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
      </label>
      <label class="toggle-field toggle-field--card">
        <input name="rememberLastFolder" type="checkbox" ${settings.rememberLastFolder ? 'checked' : ''} />
        <span>${t('settings.general.remember-folder')}</span>
      </label>
      <label class="toggle-field toggle-field--card">
        <input name="openLinksInNewTab" type="checkbox" ${settings.openLinksInNewTab ? 'checked' : ''} />
        <span>${t('settings.general.open-in-new-tab')}</span>
      </label>
    </div>
  `;
}

function resolveDockFolderSelection(folderOptions: Array<{ id: string; label: string }>, dockFolderId: string): string {
  if (dockFolderId && folderOptions.some(option => option.id === dockFolderId)) {
    return dockFolderId;
  }

  const bookmarksMenuOption = folderOptions.find(option => option.label.trim().toLowerCase() === 'bookmarks menu');
  if (bookmarksMenuOption) {
    return bookmarksMenuOption.id;
  }

  return folderOptions[0]?.id ?? '';
}

function renderBackupSection(): string {
  return `
    <div class="drawer-panel">
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.backup.export.heading')}</h3>
          <p class="field-hint">${t('settings.backup.export.hint')}</p>
        </div>
        <div class="field field--card">
          <span>${t('settings.backup.export.card-label')}</span>
          <p class="field-hint">${t('settings.backup.export.card-hint')}</p>
          <div class="empty-state__actions">
            <button class="drawer-secondary-button workspace-export-button" type="button">${t('settings.backup.export.button')}</button>
          </div>
        </div>
      </div>
      <div class="settings-section-divider" aria-hidden="true"></div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.backup.import.heading')}</h3>
          <p class="field-hint">${t('settings.backup.import.hint')}</p>
        </div>
        <div class="field field--card">
          <span>${t('settings.backup.import.card-label')}</span>
          <p class="field-hint">${t('settings.backup.import.card-hint')}</p>
          <label class="field background-upload-card__field">
            <span>${t('settings.backup.import.mode-label')}</span>
            <select name="workspaceImportMode">
              <option value="merge">${t('settings.backup.import.mode.merge')}</option>
              <option value="replace">${t('settings.backup.import.mode.replace')}</option>
            </select>
          </label>
          <div class="empty-state__actions">
            <button class="drawer-secondary-button workspace-import-button" type="button">${t('settings.backup.import.button')}</button>
          </div>
          <input class="icon-file-input" name="workspaceImportFile" type="file" accept="application/json,.json" />
        </div>
      </div>
    </div>
  `;
}

function renderHelpSection(): string {
  return `
    <div class="drawer-panel drawer-panel--help">
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.help.about.heading')}</h3>
          <p class="field-hint">${t('settings.help.about.hint')}</p>
        </div>
        <div class="shortcut-card">
          <p class="help-about-copy">${t('settings.help.about.body1')}</p>
          <p class="help-about-copy">${t('settings.help.about.body2')}</p>
        </div>
        <div class="shortcut-card">
          <div class="shortcut-list">
            <div class="shortcut-row">
              <span class="shortcut-keys">${t('settings.help.features.workspace.label')}</span>
              <span class="shortcut-description">${t('settings.help.features.workspace.description')}</span>
            </div>
            <div class="shortcut-row">
              <span class="shortcut-keys">${t('settings.help.features.customization.label')}</span>
              <span class="shortcut-description">${t('settings.help.features.customization.description')}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="settings-section-divider" aria-hidden="true"></div>
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>${t('settings.help.shortcuts.heading')}</h3>
          <p class="field-hint">${t('settings.help.shortcuts.hint')}</p>
        </div>
        <div class="shortcut-groups">
          ${getShortcutGroups().map(group => `
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

export function renderLayoutPresetCard(
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

export function renderSettingsSlider(name: string, label: string, value: number, min: number, max: number, suffix = ''): string {
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

export function renderThemeModeCard(option: { id: Exclude<ThemeMode, 'system'>; label: string; description: string; preview: 'light' | 'dark' }, currentMode: ThemeMode): string {
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
  const label = t(`options.accent.${preset.id}` as TranslationKey);
  return `
    <button class="accent-swatch" data-accent-option="${preset.value}" data-active="${String(preset.value === currentAccent)}" type="button" aria-label="${label}" title="${label}">
      <span class="accent-swatch__band" style="background:linear-gradient(135deg, ${mixHex(preset.value, '#FFFFFF', 0.18)}, ${preset.value})"></span>
      <span class="accent-swatch__label">${label}</span>
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
