import type { AppSettings } from '../../shared/messages';
import { escapeHtml } from '../../shared/html-escape';
import { renderUiIcon } from '../../shared/ui-icons';
import { accentPresets, layoutPresetOptions, renderLayoutPresetCard, renderThemeModeCard, themeModeOptions } from '../../settings';
import type { OnboardingState, OnboardingStepId } from '../state/app-state';
import { t } from '../../shared/i18n';
import type { TranslationKey } from '../../locales/en';

interface OnboardingStepMeta {
    id: OnboardingStepId;
    title: string;
    description: string;
}

function getOnboardingStepMeta(): OnboardingStepMeta[] {
    return [
        { id: 'welcome', title: t('onboarding.step.welcome.title'), description: t('onboarding.step.welcome.description') },
        { id: 'theme', title: t('onboarding.step.theme.title'), description: t('onboarding.step.theme.description') },
        { id: 'root-folder', title: t('onboarding.step.root-folder.title'), description: t('onboarding.step.root-folder.description') },
        { id: 'dock', title: t('onboarding.step.dock.title'), description: t('onboarding.step.dock.description') },
        { id: 'layout', title: t('onboarding.step.layout.title'), description: t('onboarding.step.layout.description') },
    ];
}

export function renderOnboardingWizard(
    onboarding: OnboardingState,
    settings: AppSettings,
    folderOptions: Array<{ id: string; label: string }>,
): string {
    const onboardingStepMeta = getOnboardingStepMeta();
    const activeStep = onboardingStepMeta[onboarding.stepIndex] ?? onboardingStepMeta[0];
    const isLastStep = onboarding.stepIndex >= onboardingStepMeta.length - 1;

    return `
    <div class="onboarding-wizard-layer">
      <button class="onboarding-wizard-scrim" type="button" aria-label="${t('onboarding.wizard.scrim.aria-label')}"></button>
      <section class="onboarding-wizard" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <header class="onboarding-wizard__header">
          <div class="onboarding-wizard__header-copy">
            <p class="eyebrow">${t('onboarding.wizard.eyebrow')}</p>
            <h2 id="onboarding-title">${escapeHtml(activeStep.title)}</h2>
          </div>
          <button class="onboarding-wizard-close icon-button" type="button" aria-label="${t('onboarding.wizard.close.aria-label')}">${renderUiIcon('close')}</button>
        </header>
        <div class="onboarding-wizard__body">
          <aside class="onboarding-wizard__steps" aria-label="${t('onboarding.wizard.steps.aria-label')}">
            ${onboardingStepMeta.map((step, index) => renderStepPill(step, index, onboarding.stepIndex)).join('')}
          </aside>
          <section class="onboarding-wizard__content">
            ${renderOnboardingStep(activeStep.id, settings, folderOptions)}
          </section>
        </div>
        <footer class="onboarding-wizard__footer">
          <button class="drawer-secondary-button" data-onboarding-action="skip" type="button">${t('onboarding.wizard.skip')}</button>
          <div class="onboarding-wizard__footer-actions">
            <button class="drawer-secondary-button" data-onboarding-action="back" type="button" ${onboarding.stepIndex === 0 ? 'disabled' : ''}>${t('onboarding.wizard.back')}</button>
            <button class="save-button" data-onboarding-action="${isLastStep ? 'finish' : 'next'}" type="button"><span>${isLastStep ? t('onboarding.wizard.finish') : t('onboarding.wizard.next')}</span></button>
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
            <h3>${t('onboarding.step.welcome.heading')}</h3>
            <p class="field-hint">${t('onboarding.step.welcome.body')}</p>
          </div>
          <div class="onboarding-callout">
            <p><strong>${t('onboarding.step.welcome.callout.setup-label')}</strong> ${t('onboarding.step.welcome.callout.setup-items')}</p>
            <p><strong>${t('onboarding.step.welcome.callout.time-label')}</strong> ${t('onboarding.step.welcome.callout.time-value')}</p>
          </div>
            <p class="field-hint">${t('onboarding.step.welcome.skip-hint')}</p>
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
            <h3>${t('onboarding.step.theme.heading')}</h3>
            <p class="field-hint">${t('onboarding.step.theme.hint')}</p>
          </div>
          <div class="theme-mode-grid" role="group" aria-label="${t('onboarding.step.theme.mode-group.aria-label')}">
            ${themeModeOptions.map(option => renderThemeModeCard(option, settings.themeMode)).join('')}
          </div>
          <div class="accent-gallery" role="group" aria-label="${t('onboarding.step.theme.accent-group.aria-label')}">
            ${accentPresets.map(preset => {
              const label = t(`options.accent.${preset.id}` as TranslationKey);
              return `
              <button class="accent-swatch" data-accent-option="${preset.value}" data-active="${String(preset.value === customAccentActive)}" type="button" aria-label="${label}" title="${label}">
                <span class="accent-swatch__band" style="background:linear-gradient(135deg, ${preset.value}, color-mix(in srgb, ${preset.value} 58%, #FFFFFF))"></span>
                <span class="accent-swatch__label">${label}</span>
              </button>
            `;
            }).join('')}
          </div>
          <p class="field-hint">${t('onboarding.step.theme.custom-hint')}</p>
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
            <h3>${t('onboarding.step.root-folder.heading')}</h3>
            <p class="field-hint">${t('onboarding.step.root-folder.hint')}</p>
          </div>
          <label class="field field--card">
            <span>${t('onboarding.step.root-folder.label')}</span>
            <select name="rootFolderId">
              <option value="">${t('onboarding.step.root-folder.default-option')}</option>
              ${folderOptions.map(option => `<option value="${option.id}" ${option.id === settings.rootFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
          </label>
          <label class="toggle-field toggle-field--card">
            <input name="rememberLastFolder" type="checkbox" ${settings.rememberLastFolder ? 'checked' : ''} />
            <span>${t('onboarding.step.root-folder.remember-label')}</span>
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
            <h3>${t('onboarding.step.dock.heading')}</h3>
            <p class="field-hint">${t('onboarding.step.dock.hint')}</p>
          </div>
          <label class="field field--card">
            <span>${t('onboarding.step.dock.folder-label')}</span>
            <select name="dockFolderId">
              ${folderOptions.map(option => `<option value="${option.id}" ${option.id === selectedDockFolderId ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
          </label>
          <div class="field field--card">
            <span>${t('onboarding.step.dock.visibility-label')}</span>
            <div class="settings-subnav" role="group" aria-label="${t('onboarding.step.dock.visibility.aria-label')}">
              <button class="settings-subnav__button" data-dock-visibility-option="always" data-active="${String(dockVisibilityMode === 'always')}" type="button">${t('onboarding.step.dock.visibility.always')}</button>
              <button class="settings-subnav__button" data-dock-visibility-option="hover" data-active="${String(dockVisibilityMode === 'hover')}" type="button">${t('onboarding.step.dock.visibility.hover')}</button>
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
          <h3>${t('onboarding.step.layout.heading')}</h3>
          <p class="field-hint">${t('onboarding.step.layout.hint')}</p>
        </div>
        <div class="layout-preset-grid" role="group" aria-label="${t('onboarding.step.layout.presets.aria-label')}">
          ${layoutPresetOptions.map(option => renderLayoutPresetCard(option, activePreset)).join('')}
        </div>
        <p class="field-hint">${t('onboarding.step.layout.custom-hint')}</p>
      </div>
      ${renderIllustrationSlot('layout')}
    </div>
  `;
}

const ILLUSTRATION_SRCS: Partial<Record<OnboardingStepId, string>> = {
    // Uncomment each entry once the screenshot is ready:
    // welcome: 'img/onboarding-welcome.png',
    // theme: 'img/onboarding-theme.png',
    // 'root-folder': 'img/onboarding-root-folder.png',
    // dock: 'img/onboarding-dock.png',
    // layout: 'img/onboarding-layout.png',
};

function renderIllustrationSlot(stepId: OnboardingStepId): string {
    const src = ILLUSTRATION_SRCS[stepId];
    if (!src) return '';
    return `
    <aside class="onboarding-illustration" data-illustration-step="${stepId}">
      <img class="onboarding-illustration__img" src="${src}" alt="" />
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
