import type { AppSettings } from '../../shared/messages';
import { escapeHtml } from '../../shared/html-escape';
import { renderUiIcon } from '../../shared/ui-icons';
import { accentPresets, layoutPresetOptions, renderLayoutPresetCard, renderThemeModeCard, themeModeOptions } from '../../settings';
import type { OnboardingState, OnboardingStepId } from '../state/app-state';

interface OnboardingStepMeta {
    id: OnboardingStepId;
    title: string;
    description: string;
}

const onboardingStepMeta: OnboardingStepMeta[] = [
    {
        id: 'welcome',
        title: 'Welcome',
        description: 'Set up your workspace in a few quick steps.',
    },
    {
        id: 'theme',
        title: 'Theme',
        description: 'Pick the visual mode and accent that fits your style.',
    },
    {
        id: 'root-folder',
        title: 'Starting Folder',
        description: 'Choose which bookmark folder opens first.',
    },
    {
        id: 'dock',
        title: 'Dock',
        description: 'Configure the bottom dock for fast access.',
    },
    {
        id: 'layout',
        title: 'Layout',
        description: 'Choose the grid preset or customize spacing.',
    },
];

export function renderOnboardingWizard(
    onboarding: OnboardingState,
    settings: AppSettings,
    folderOptions: Array<{ id: string; label: string }>,
): string {
    const activeStep = onboardingStepMeta[onboarding.stepIndex] ?? onboardingStepMeta[0];
    const isLastStep = onboarding.stepIndex >= onboardingStepMeta.length - 1;

    return `
    <div class="onboarding-wizard-layer">
      <button class="onboarding-wizard-scrim" type="button" aria-label="Close onboarding"></button>
      <section class="onboarding-wizard" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header class="onboarding-wizard__header">
          <div class="onboarding-wizard__header-copy">
            <p class="eyebrow">New workspace setup</p>
            <h2 id="onboarding-title">${escapeHtml(activeStep.title)}</h2>
          </div>
          <button class="onboarding-wizard-close icon-button" type="button" aria-label="Skip onboarding and close">${renderUiIcon('close')}</button>
        </header>
        <div class="onboarding-wizard__body">
          <aside class="onboarding-wizard__steps" aria-label="Onboarding steps">
            ${onboardingStepMeta.map((step, index) => renderStepPill(step, index, onboarding.stepIndex)).join('')}
          </aside>
          <section class="onboarding-wizard__content">
            ${renderOnboardingStep(activeStep.id, settings, folderOptions)}
          </section>
        </div>
        <footer class="onboarding-wizard__footer">
          <button class="drawer-secondary-button" data-onboarding-action="skip" type="button">Skip setup</button>
          <div class="onboarding-wizard__footer-actions">
            <button class="drawer-secondary-button" data-onboarding-action="back" type="button" ${onboarding.stepIndex === 0 ? 'disabled' : ''}>Back</button>
            <button class="save-button" data-onboarding-action="${isLastStep ? 'finish' : 'next'}" type="button"><span>${isLastStep ? 'Finish setup' : 'Next'}</span></button>
          </div>
        </footer>
      </section>
    </div>
  `;
}

function renderStepPill(step: OnboardingStepMeta, index: number, activeIndex: number): string {
    const state = index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'upcoming';
    return `
    <button class="onboarding-step-pill" data-onboarding-step="${String(index)}" data-state="${state}" type="button" aria-current="${index === activeIndex ? 'step' : 'false'}">
      <span class="onboarding-step-pill__index">${String(index + 1)}</span>
      <span class="onboarding-step-pill__label">${escapeHtml(step.title)}</span>
    </button>
  `;
}

function renderOnboardingStep(stepId: OnboardingStepId, settings: AppSettings, folderOptions: Array<{ id: string; label: string }>): string {
    if (stepId === 'welcome') {
        return `
      <div class="onboarding-step onboarding-step--welcome">
        <div class="visual-section">
          <div class="visual-section__header">
            <h3>Thank you for trying Flipp's Favorites!</h3>
            <p class="field-hint">This short wizard will guide you through the initial setup of your workspace.</p>
          </div>
          <div class="onboarding-callout">
            <p><strong>Set up:</strong> theme, starting folder, dock behavior, and layout.</p>
            <p><strong>Time:</strong> about one minute.</p>
          </div>
            <p class="field-hint">You can skip this setup at any time and configure your preferences later in the Settings.</p>
        </div>
        ${renderIllustrationSlot('welcome')}
      </div>
    `;
    }

    if (stepId === 'theme') {
        const customAccentActive = settings.accentColor.toUpperCase();
        return `
      <div class="onboarding-step">
        <div class="visual-section">
          <div class="visual-section__header">
            <h3>Choose your theme mode</h3>
            <p class="field-hint">Use the same visual cards from settings so your choices stay consistent everywhere.</p>
          </div>
          <div class="theme-mode-grid" role="group" aria-label="Theme mode">
            ${themeModeOptions.map(option => renderThemeModeCard(option, settings.themeMode)).join('')}
          </div>
          <div class="accent-gallery" role="group" aria-label="Accent presets">
            ${accentPresets.map(preset => `
              <button class="accent-swatch" data-accent-option="${preset.value}" data-active="${String(preset.value === customAccentActive)}" type="button" aria-label="${preset.label}" title="${preset.label}">
                <span class="accent-swatch__band" style="background:linear-gradient(135deg, ${preset.value}, color-mix(in srgb, ${preset.value} 58%, #FFFFFF))"></span>
                <span class="accent-swatch__label">${preset.label}</span>
              </button>
            `).join('')}
          </div>
          <p class="field-hint">Prefer a custom accent color? You can set it later in Settings under Theme.</p>
        </div>
        ${renderIllustrationSlot('theme')}
      </div>
    `;
    }

    if (stepId === 'root-folder') {
        return `
      <div class="onboarding-step">
        <div class="visual-section">
          <div class="visual-section__header">
            <h3>Pick your starting folder</h3>
            <p class="field-hint">Choose which folder will be shown each time when a new tab opens.</p>
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
            <span>Remember the last folder you visited</span>
          </label>
        </div>
        ${renderIllustrationSlot('root-folder')}
      </div>
    `;
    }

    if (stepId === 'dock') {
        const dockVisibilityMode = settings.showDock && settings.autoHideDock ? 'hover' : 'always';
        const selectedDockFolderId = resolveDockFolderSelection(folderOptions, settings.dockFolderId);
        return `
      <div class="onboarding-step">
        <div class="visual-section">
          <div class="visual-section__header">
            <h3>Configure your dock</h3>
            <p class="field-hint">Keep important folders pinned at the bottom of the page.</p>
          </div>
          <label class="field field--card">
            <span>Dock folder</span>
            <select name="dockFolderId">
              ${folderOptions.map(option => `<option value="${option.id}" ${option.id === selectedDockFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
          </label>
          <div class="field field--card">
            <span>Visibility</span>
            <div class="settings-subnav" role="group" aria-label="Dock visibility">
              <button class="settings-subnav__button" data-dock-visibility-option="always" data-active="${String(dockVisibilityMode === 'always')}" type="button">Always</button>
              <button class="settings-subnav__button" data-dock-visibility-option="hover" data-active="${String(dockVisibilityMode === 'hover')}" type="button">Hover</button>
            </div>
          </div>
        </div>
        ${renderIllustrationSlot('dock')}
      </div>
    `;
    }

    const activePreset = settings.layoutPreset;
    return `
    <div class="onboarding-step">
      <div class="visual-section">
        <div class="visual-section__header">
          <h3>Choose a layout</h3>
          <p class="field-hint">Preset cards match the settings drawer and can be refined with custom controls.</p>
        </div>
        <div class="layout-preset-grid" role="group" aria-label="Layout presets">
          ${layoutPresetOptions.map(option => renderLayoutPresetCard(option, activePreset)).join('')}
        </div>
        <p class="field-hint">Custom layout options are available in the Settings later.</p>
      </div>
      ${renderIllustrationSlot('layout')}
    </div>
  `;
}

function renderIllustrationSlot(stepId: OnboardingStepId): string {
    return `
    <aside class="onboarding-illustration" data-illustration-step="${stepId}">
      <div class="onboarding-illustration__placeholder">
        <span class="onboarding-illustration__badge">Screenshot slot</span>
        <p>Add step-specific imagery here later.</p>
      </div>
    </aside>
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
