import { sendRuntimeMessage } from '../../shared/browser';
import { messageTypes, type CreateBookmarkResponse, type GetIconResponse, type InvalidateIconResponse, type RemoveIconOverrideResponse, type ResolvedIcon, type SearchIconsResponse, type SetIconOverrideFromUrlResponse, type SetIconOverrideResponse, type UpdateBookmarkResponse } from '../../shared/messages';
import { type AppState, type BookmarkDialogState } from '../state/app-state';
import { getHostname, type BookmarkActionTarget } from './bookmark-navigation';
import { escapeAttribute, escapeHtml } from '../../shared/html-escape';
import { getFaviconImageUrl, renderIconPlaceholder } from '../icons/icon-render';
import { getSearchName, isValidBookmarkUrl } from '../helpers/bookmark-validation';
import { normalizeUploadedImage } from '../helpers/image-normalization';
import { type RenderAppFn, refreshBookmarkTree } from '../state/state-transitions';
import { renderUiIcon } from '../../shared/ui-icons';
import { t } from '../../shared/i18n';

export function renderBookmarkDialog(bookmarkDialog: BookmarkDialogState): string {
  const title = bookmarkDialog.target?.title || 'Bookmark';
  const draftTitle = bookmarkDialog.draftTitle.trim();
  const draftUrl = bookmarkDialog.draftUrl.trim();
  const canSaveBookmark = draftTitle.length > 0 && isValidBookmarkUrl(draftUrl);
  const previewMarkup = bookmarkDialog.previewIcon && bookmarkDialog.previewIcon.sourceKind !== 'generated'
    ? `<img class="bookmark-dialog__preview-image" src="${escapeAttribute(bookmarkDialog.previewIcon.dataUrl)}" alt="" />`
    : (bookmarkDialog.target
      ? `<img class="bookmark-dialog__preview-image" src="${escapeAttribute(getFaviconImageUrl(bookmarkDialog.target.url, 'dialog'))}" alt="" referrerpolicy="no-referrer" />`
      : renderIconPlaceholder(title));

  return `
    <div class="bookmark-dialog-layer">
      <button class="bookmark-dialog-scrim" type="button" aria-label="${t('bookmark.dialog.scrim.aria-label')}"></button>
      <section class="bookmark-dialog" role="dialog" aria-modal="true" aria-label="${t('bookmark.dialog.aria-label')}">
        <header class="bookmark-dialog__header">
          <div class="bookmark-dialog__header-copy">
            <p class="eyebrow">${t('bookmark.dialog.eyebrow')}</p>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <button class="bookmark-dialog-close icon-button" type="button" aria-label="${t('bookmark.dialog.close.aria-label')}">${renderUiIcon('close')}</button>
        </header>
        <div class="bookmark-dialog__body">
          <aside class="bookmark-dialog__preview-panel">
            <div class="bookmark-dialog__edit-fields">
              <label class="field bookmark-dialog__field">
                <span>${t('bookmark.dialog.name-label')}</span>
                <input name="bookmarkDialogTitle" type="text" value="${escapeAttribute(bookmarkDialog.draftTitle)}" placeholder="${t('bookmark.dialog.name-placeholder')}" required />
              </label>
              <label class="field bookmark-dialog__field">
                <span>${t('bookmark.dialog.url-label')}</span>
                <input name="bookmarkDialogUrl" type="url" value="${escapeAttribute(bookmarkDialog.draftUrl)}" placeholder="${t('bookmark.dialog.url-placeholder')}" required />
              </label>
              <button class="save-button button-with-icon bookmark-dialog-save-button" type="button" ${canSaveBookmark ? '' : 'disabled'}>${renderUiIcon('save')}<span>${t('bookmark.dialog.save')}</span></button>
            </div>
            <div class="bookmark-dialog__preview">
              ${previewMarkup}
              <div class="bookmark-dialog__preview-actions">
                <button class="bookmark-dialog__preview-action bookmark-dialog__preview-action--refresh bookmark-dialog-refresh-button" type="button" aria-label="${t('bookmark.dialog.icon.refresh.aria-label')}" title="${t('bookmark.dialog.icon.refresh.title')}">${renderUiIcon('refresh')}</button>
                <button class="bookmark-dialog__preview-action bookmark-dialog__preview-action--remove bookmark-dialog-remove-button" type="button" aria-label="${t('bookmark.dialog.icon.remove.aria-label')}" title="${t('bookmark.dialog.icon.remove.title')}">${renderUiIcon('trash')}</button>
                <button class="bookmark-dialog__preview-action bookmark-dialog__preview-action--upload bookmark-dialog-upload-button" type="button" aria-label="${t('bookmark.dialog.icon.upload.aria-label')}" title="${t('bookmark.dialog.icon.upload.title')}">${renderUiIcon('upload')}<span>${t('bookmark.dialog.icon.upload-button')}</span></button>
              </div>
            </div>
            <p class="field-hint">${t('bookmark.dialog.preview-hint')}</p>
            <input class="icon-file-input" name="bookmarkDialogFile" type="file" accept="image/*" />
            ${bookmarkDialog.status ? `<div class="bookmark-dialog-toast" data-kind="${bookmarkDialog.statusKind || 'info'}" role="status">${escapeHtml(bookmarkDialog.status)}</div>` : ''}
          </aside>
          <div class="bookmark-dialog__search-panel">
            <div class="visual-section__header">
              <h3>${t('bookmark.dialog.search.heading')}</h3>
              <p class="field-hint">${t('bookmark.dialog.search.hint')}</p>
            </div>
            <div class="bookmark-dialog__search-row">
              <input name="bookmarkDialogSearchQuery" type="search" value="${escapeAttribute(bookmarkDialog.query)}" placeholder="${t('bookmark.dialog.search.placeholder')}" />
              <button class="save-button button-with-icon bookmark-dialog-search-button" type="button">${renderUiIcon('search')}<span>${t('bookmark.dialog.search.button')}</span></button>
            </div>
            <div class="bookmark-dialog__results" data-loading="${String(bookmarkDialog.loading)}">
              ${renderBookmarkDialogResults(bookmarkDialog)}
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

export async function openBookmarkDialog(rootElement: HTMLDivElement, state: AppState, target: BookmarkActionTarget, renderApp: RenderAppFn): Promise<void> {
  state.bookmarkDialog = {
    open: true,
    target,
    draftTitle: target.title || '',
    draftUrl: target.url,
    query: `${getSearchName(target.url) || target.title} logo`,
    status: '',
    statusKind: '',
    loading: true,
    results: [],
    previewIcon: null,
  };
  renderApp(rootElement, state);
  await Promise.allSettled([
    loadBookmarkDialogPreview(state, target, rootElement, renderApp),
    searchBookmarkDialog(rootElement, state, state.bookmarkDialog.query, renderApp),
  ]);
}

export async function loadBookmarkDialogPreview(state: AppState, target: BookmarkActionTarget, rootElement?: HTMLDivElement, renderApp?: RenderAppFn): Promise<void> {
  const response = await sendRuntimeMessage<{
    type: typeof messageTypes.getIcon;
    bookmarkUrl: string;
    bookmarkTitle?: string;
  }, GetIconResponse>({
    type: messageTypes.getIcon,
    bookmarkUrl: target.url,
    bookmarkTitle: target.title,
  });

  if (!state.bookmarkDialog.open || state.bookmarkDialog.target?.url !== target.url) {
    return;
  }

  state.bookmarkDialog.previewIcon = response.icon;
  state.resolvedIcons[target.url] = response.icon;
  if (rootElement && renderApp) {
    renderApp(rootElement, state);
  }
}

export async function searchBookmarkDialog(rootElement: HTMLDivElement, state: AppState, query: string, renderApp: RenderAppFn): Promise<void> {
  const target = state.bookmarkDialog.target;
  if (!target) {
    return;
  }

  state.bookmarkDialog.loading = true;
  state.bookmarkDialog.status = t('bookmark.dialog.status.searching', { name: target.title || getHostname(target.url) });
  state.bookmarkDialog.statusKind = 'info';
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

    if (!state.bookmarkDialog.open || state.bookmarkDialog.target?.url !== target.url) {
      return;
    }

    state.bookmarkDialog.query = query;
    state.bookmarkDialog.loading = false;
    state.bookmarkDialog.results = response.candidates;
    state.bookmarkDialog.status = response.candidates.length
      ? t('bookmark.dialog.status.found-candidates', { count: response.candidates.length })
      : t('bookmark.dialog.status.no-candidates');
    state.bookmarkDialog.statusKind = response.candidates.length ? 'info' : 'error';
    renderApp(rootElement, state);
  } catch {
    if (!state.bookmarkDialog.open || state.bookmarkDialog.target?.url !== target.url) {
      return;
    }

    state.bookmarkDialog.loading = false;
    state.bookmarkDialog.results = [];
    state.bookmarkDialog.status = t('bookmark.dialog.status.search-failed');
    state.bookmarkDialog.statusKind = 'error';
    renderApp(rootElement, state);
  }
}

export async function saveBookmarkDialogBookmark(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn): Promise<void> {
  const target = state.bookmarkDialog.target;
  if (!target) {
    return;
  }

  const nextTitle = state.bookmarkDialog.draftTitle.trim();
  const nextUrl = state.bookmarkDialog.draftUrl.trim();
  if (!nextTitle) {
    state.bookmarkDialog.status = t('bookmark.dialog.status.name-required');
    state.bookmarkDialog.statusKind = 'error';
    renderApp(rootElement, state);
    return;
  }

  if (!nextUrl) {
    state.bookmarkDialog.status = t('bookmark.dialog.status.url-required');
    state.bookmarkDialog.statusKind = 'error';
    renderApp(rootElement, state);
    return;
  }

  if (!isValidBookmarkUrl(nextUrl)) {
    state.bookmarkDialog.status = t('bookmark.dialog.status.url-invalid');
    state.bookmarkDialog.statusKind = 'error';
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

  const updatedTarget = state.bookmarkDialog.target;
  if (updatedTarget) {
    state.bookmarkDialog.draftTitle = updatedTarget.title || nextTitle;
    state.bookmarkDialog.draftUrl = updatedTarget.url;
    state.bookmarkDialog.status = t('bookmark.dialog.status.saved', { name: updatedTarget.title || getHostname(updatedTarget.url) });
    state.bookmarkDialog.statusKind = 'success';
    state.bookmarkDialog.query = `${updatedTarget.title || getSearchName(updatedTarget.url)} logo`;
    await loadBookmarkDialogPreview(state, updatedTarget);
  }

  renderApp(rootElement, state);
}

export async function uploadBookmarkDialogImage(rootElement: HTMLDivElement, state: AppState, file: File, renderApp: RenderAppFn): Promise<void> {
  const target = state.bookmarkDialog.target;
  if (!target) {
    return;
  }

  try {
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

    state.bookmarkDialog.status = t('bookmark.dialog.status.icon-saved', { name: target.title || getHostname(target.url) });
    state.bookmarkDialog.statusKind = 'success';
    state.bookmarkDialog.previewIcon = {
      cacheKey: `override:${target.url}`,
      sourceKind: 'override',
      dataUrl: normalizedDataUrl,
      lastUpdated: Date.now(),
      isFallback: false,
    };
    state.resolvedIcons[target.url] = state.bookmarkDialog.previewIcon;
  } catch (error) {
    state.bookmarkDialog.status = getIconPersistenceErrorMessage(error, 'upload');
    state.bookmarkDialog.statusKind = 'error';
  }

  renderApp(rootElement, state);
}

export async function refreshBookmarkDialogIcon(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn): Promise<void> {
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

  state.bookmarkDialog.status = t('bookmark.dialog.status.icon-refreshed', { name: dialogTarget.title || getHostname(dialogTarget.url) });
  state.bookmarkDialog.statusKind = 'info';
  await loadBookmarkDialogPreview(state, dialogTarget, rootElement, renderApp);
  renderApp(rootElement, state);
}

export async function removeBookmarkDialogOverride(rootElement: HTMLDivElement, state: AppState, renderApp: RenderAppFn): Promise<void> {
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

  state.bookmarkDialog.status = t('bookmark.dialog.status.icon-removed', { name: dialogTarget.title || getHostname(dialogTarget.url) });
  state.bookmarkDialog.statusKind = 'info';
  await loadBookmarkDialogPreview(state, dialogTarget, rootElement, renderApp);
  renderApp(rootElement, state);
}

export async function applyBookmarkDialogCandidate(rootElement: HTMLDivElement, state: AppState, imageUrl: string, renderApp: RenderAppFn): Promise<void> {
  const dialogTarget = state.bookmarkDialog.target;
  if (!dialogTarget) {
    return;
  }

  try {
    const response = await sendRuntimeMessage<{
      type: typeof messageTypes.setIconOverrideFromUrl;
      bookmarkUrl: string;
      bookmarkTitle?: string;
      imageUrl: string;
      fileName?: string;
    }, SetIconOverrideFromUrlResponse>({
      type: messageTypes.setIconOverrideFromUrl,
      bookmarkUrl: dialogTarget.url,
      bookmarkTitle: dialogTarget.title,
      imageUrl,
    });

    state.bookmarkDialog.status = t('bookmark.dialog.status.icon-applied', { name: dialogTarget.title || getHostname(dialogTarget.url) });
    state.bookmarkDialog.statusKind = 'success';
    state.bookmarkDialog.previewIcon = response.icon;
    state.resolvedIcons[dialogTarget.url] = response.icon;
  } catch (error) {
    state.bookmarkDialog.status = getIconPersistenceErrorMessage(error, 'search');
    state.bookmarkDialog.statusKind = 'error';
  }

  renderApp(rootElement, state);
}

function renderBookmarkDialogResults(bookmarkDialog: BookmarkDialogState): string {
  if (bookmarkDialog.loading) {
    return `<p class="field-hint">${t('bookmark.dialog.results.loading')}</p>`;
  }

  if (!bookmarkDialog.results.length) {
    return `<p class="field-hint">${t('bookmark.dialog.results.empty')}</p>`;
  }

  return bookmarkDialog.results.map(candidate => `
    <button class="icon-result-card" data-icon-candidate-url="${escapeAttribute(candidate.imageUrl)}" type="button" title="${escapeAttribute(candidate.label)}">
      <img class="icon-result-card__image" src="${escapeAttribute(candidate.previewUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <span class="icon-result-card__label">${escapeHtml(candidate.label)}</span>
    </button>
  `).join('');
}

function getIconPersistenceErrorMessage(error: unknown, source: 'upload' | 'search'): string {
  const message = String(error instanceof Error ? error.message : error).toLowerCase();
  if (message.includes('quota')) {
    return t('bookmark.dialog.error.storage-full');
  }

  if (source === 'search' && (message.includes('fetch') || message.includes('network'))) {
    return t('bookmark.dialog.error.download-failed');
  }

  return t('bookmark.dialog.error.save-failed');
}
